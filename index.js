/**
 * dsh-plugin-the-architect
 * Cordis Plugin per DeepSeek Harness (DSH)
 * Implementazione del Runtime ICM (Interpretable Context Methodology),
 * Triage State Machine con Gate di Trivialità, Zero-Token Handoff,
 * Linter AST/Regex Deterministico a 3-Retry, e Controllo Runner Docker.
 */

import { promises as fs } from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';
const TASKS_DIR = path.join(WORKSPACE_DIR, '.dsh', 'tasks');
const PLAN_JSON = path.join(TASKS_DIR, 'plan.json');
const MASTER_PLAN_MD = path.join(TASKS_DIR, '00_master_plan.md');
const SKILLS_DIR = path.join(WORKSPACE_DIR, '.dsh', 'skills');
const SEEDS_DIR = path.join(__dirname, 'seeds');
const CONFIG_FILE = path.join(WORKSPACE_DIR, '.dsh', 'capabilities.json');
const DOCKER_SOCKET = '/var/run/docker.sock';

// Stato dei toggle di default
const DEFAULT_CAPABILITIES = {
  the_architect: true,
  graphify_vault: true,
  deep_osint: false,
  software_factory: true,
  persistent_memory: true
};

/**
 * Richiesta HTTP nativa su UNIX Socket di Docker (senza dipendenze npm)
 */
function dockerSocketRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: DOCKER_SOCKET,
      path: endpoint,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'docker.sock'
      }
    };

    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        try {
          const parsed = rawData ? JSON.parse(rawData) : {};
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: rawData });
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Docker Socket Error (${endpoint}): ${err.message}`));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Bootstrap iniziale delle cartelle e dei semi delle skill (.dsh/skills)
 */
async function bootstrapEnvironment() {
  try {
    await fs.mkdir(TASKS_DIR, { recursive: true });
    await fs.mkdir(SKILLS_DIR, { recursive: true });

    // Se skills è vuota o manca l'indice, semina i blueprint essenziali
    const existingSkills = await fs.readdir(SKILLS_DIR).catch(() => []);
    if (existingSkills.length === 0) {
      const seedFiles = await fs.readdir(SEEDS_DIR).catch(() => []);
      for (const file of seedFiles) {
        if (file.endsWith('.md')) {
          const content = await fs.readFile(path.join(SEEDS_DIR, file), 'utf8');
          await fs.writeFile(path.join(SKILLS_DIR, file), content, 'utf8');
        }
      }
    }

    // Inizializza capabilities.json se assente
    try {
      await fs.access(CONFIG_FILE);
    } catch {
      await fs.writeFile(CONFIG_FILE, JSON.stringify(DEFAULT_CAPABILITIES, null, 2), 'utf8');
    }

    // Inizializza skills-index.json per il routing leggero
    const skillsList = await fs.readdir(SKILLS_DIR).catch(() => []);
    const indexData = skillsList.filter(f => f.endsWith('.skill.md') || f.endsWith('.md')).map(f => ({
      name: f.replace(/\.skill\.md$|\.md$/, ''),
      path: path.join('.dsh', 'skills', f)
    }));
    await fs.writeFile(path.join(WORKSPACE_DIR, '.dsh', 'skills-index.json'), JSON.stringify(indexData, null, 2), 'utf8');
  } catch (err) {
    console.error(`[the-architect] Errore durante il bootstrap: ${err.message}`);
  }
}

/**
 * Gate di Trivialità: analizza se una richiesta è conversazionale/atomica o multi-task
 */
function evaluateTriviality(prompt) {
  if (!prompt || typeof prompt !== 'string') return { isTrivial: true, reason: 'Empty prompt' };
  
  const p = prompt.toLowerCase();

  // Parole chiave obbligatorie che forzano SEMPRE il percorso The Architect
  const architectKeywords = [
    '/architect', 'architect', 'architettura', 'workflow', 'pianifica', 'pianificazione',
    'pipeline', 'progetto', 'task', 'piano', 'organizza', 'automazione', 'monitoraggio'
  ];
  for (const akw of architectKeywords) {
    if (p.includes(akw)) {
      return {
        isTrivial: false,
        reason: `Rilevata intenzione strutturata / The Architect ('${akw}'). Richiede Master Plan e Plan Sidebar.`
      };
    }
  }

  const trivialKeywords = [
    'ricetta', 'tortellini', 'pasta', 'cucinare', 'meteo', 'ciao', 'buongiorno',
    'chi sei', 'come stai', 'traduci', 'spiegami in 2 righe', 'che ore sono',
    'come si dichiara', 'sintassi per', 'differenza tra let e var'
  ];

  for (const kw of trivialKeywords) {
    if (p.includes(kw)) {
      return {
        isTrivial: true,
        reason: `Rilevata intenzione rapida/conversazionale ('${kw}'). Bypass totale della fabbrica.`
      };
    }
  }

  // Se il prompt è molto breve (< 40 caratteri) e non contiene parole chiave operative
  if (p.length < 40 && !p.includes('progetto') && !p.includes('analizza') && !p.includes('refactor') && !p.includes('vault')) {
    return {
      isTrivial: true,
      reason: 'Richiesta breve non strutturata. Risposta diretta senza overhead.'
    };
  }

  return {
    isTrivial: false,
    reason: 'Richiesta multi-fase o complessa. Richiede Triage e Master Plan.'
  };
}

/**
 * Sincronizza lo stato del piano universale:
 * scrive sia il Markdown completo (.dsh/tasks/00_master_plan.md)
 * sia il formato JSON consumato direttamente dalla Plan Sidebar (.dsh/tasks/plan.json).
 */
async function syncPlanState({ plan_id, title, description, status, tasks, markdown_plan }) {
  await fs.mkdir(TASKS_DIR, { recursive: true });

  const formattedTasks = (tasks || []).map((t, idx) => {
    const taskId = t.id || `TASK-${String(idx + 1).padStart(2, '0')}`;
    return {
      id: taskId,
      title: t.title || `Fase ${idx + 1}`,
      description: t.description || '',
      status: t.status || 'PENDING',
      assigned_role: t.assigned_role || 'curator',
      runner: t.runner || 'native',
      deliverable_file: t.deliverable_file || `.dsh/tasks/task_${String(idx + 1).padStart(2, '0')}_result.md`,
      preview_content: t.preview_content || null,
      error_message: t.error_message || null
    };
  });

  const pid = plan_id || 'PLAN-01';
  const planTitle = title || 'Piano Operativo The Architect';
  const planDesc = description || '';
  const planStatus = status || 'PENDING_APPROVAL';

  let mdContent = markdown_plan;
  if (!mdContent) {
    mdContent = [
      `# 🏛️ Master Plan: ${pid} - ${planTitle}`,
      ``,
      `> **Status:** ${planStatus} | **Aggiornato:** ${new Date().toISOString()}`,
      ``,
      `## 1. Executive Summary & Obiettivo`,
      planDesc || 'Pianificazione strutturata del workflow multi-fase.',
      ``,
      `## 2. DAG dei Task Sequenziali`,
      ...formattedTasks.map(t => `- **${t.id}: ${t.title}** (Ruolo: \`${t.assigned_role}\`, Runner: \`${t.runner}\`, Deliverable: \`${t.deliverable_file}\`)`),
      ``,
      `## 3. Protocollo di Gate & Approvazione`,
      `- **Gate 1 (Pianificazione):** Approvazione del supervisore umano prima dell'avvio dei task.`,
      `- **Gate 2 (Verifica Deliverable):** Audit Linter AST/Regex (max 3 retry) su ciascun deliverable.`,
      `- **Gate 3 (Chiusura):** Consolidamento finale in Obsidian Vault e chiusura del ciclo.`
    ].join('\n');
  }

  await fs.writeFile(MASTER_PLAN_MD, mdContent, 'utf8');

  const payload = {
    plan_id: pid,
    title: planTitle,
    description: planDesc,
    status: planStatus,
    updated_at: new Date().toISOString(),
    tasks: formattedTasks
  };

  await fs.writeFile(PLAN_JSON, JSON.stringify(payload, null, 2), 'utf8');
  return { payload, formattedTasks, mdContent };
}

/**
 * Linter Deterministico AST / Regex
 */
function auditMarkdownContent(content) {
  const lines = content.split('\n');
  const totalLines = lines.length;
  if (totalLines === 0) return { passed: true, issues: [] };

  const issues = [];

  // 1. Vincolo Elenchi Puntati (< 10% delle righe totali)
  let bulletLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      bulletLines++;
    }
  }
  const bulletRatio = (bulletLines / totalLines) * 100;
  if (bulletRatio > 10) {
    issues.push(`Elenchi puntati al ${bulletRatio.toFixed(1)}% (limite massimo consentito: 10%). Riscrivi in prosa continua strutturata con sezioni concettuali.`);
  }

  // 2. Divieto Emoji
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  const emojiMatches = content.match(emojiRegex);
  if (emojiMatches) {
    issues.push(`Rilevate emoji nel testo formale ('${emojiMatches[0]}'). Il manifesto formale proibisce severamente l'uso di emoji.`);
  }

  // 3. Divieto di acronimi sparsi non contestualizzati (MECE, SCQA, BLUF, NPOV)
  const forbiddenAcronyms = ['MECE', 'SCQA', 'BLUF', 'NPOV'];
  for (const acr of forbiddenAcronyms) {
    const r = new RegExp(`\\b${acr}\\b`, 'g');
    if (r.test(content)) {
      // Consentito solo nei callout di intestazione, vietato nel corpo
      const matches = content.split('\n').filter(l => !l.startsWith('>') && r.test(l));
      if (matches.length > 0) {
        issues.push(`Uso non schermato dell'acronimo metodologico '${acr}' nel corpo del testo. Demistificare il concetto senza citare l'acronimo.`);
      }
    }
  }

  return {
    passed: issues.length === 0,
    bulletRatio: bulletRatio.toFixed(1),
    issues
  };
}

export const name = 'the-architect';
export const inject = ['tools', 'commands', 'systemPrompt'];

export function apply(ctx) {
  // Avvia il bootstrap dell'ambiente al caricamento del plugin
  bootstrapEnvironment();

  if (!ctx.tools || typeof ctx.tools.register !== 'function') {
    return;
  }

  // --------------------------------------------------------------------------
  // TOOL 1: architect_create_plan (Plan Sidebar & Master Plan Orchestrator)
  // --------------------------------------------------------------------------
  ctx.tools.register({
    name: 'architect_create_plan',
    description: 'MANDATORY: Crea e salva il Master Plan formale (.dsh/tasks/00_master_plan.md) e aggiorna in tempo reale la Plan Sidebar (.dsh/tasks/plan.json) con le schede dei task, i ruoli assegnati e i deliverable. DEVE essere invocato ogni volta che l\'utente richiede la pianificazione di un workflow, architettura o progetto, o quando viene usato il comando /architect.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'ID univoco del piano (es. "PLAN-01")' },
      title: { type: 'string', required: true, description: 'Titolo descrittivo del workflow o progetto' },
      description: { type: 'string', required: false, description: 'Sintesi dell\'obiettivo del piano' },
      status: { type: 'string', required: false, description: '"PENDING_APPROVAL", "IN_PROGRESS", "APPROVED", o "COMPLETED"' },
      tasks: {
        type: 'array',
        required: true,
        description: 'Array di task sequenziali: [{ id: "TASK-01", title: "...", description: "...", assigned_role: "curator"|"auditor"|"engineer"|"osint", runner: "native"|"python"|"expo"|"go"|"rust", deliverable_file: ".dsh/tasks/task_01_result.md" }]'
      },
      markdown_plan: {
        type: 'string',
        required: false,
        description: 'Contenuto Markdown formale ed esaustivo da salvare in .dsh/tasks/00_master_plan.md (Executive Summary, DAG architetturale, ruoli, gate).'
      }
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          plan_id: { type: 'string' },
          plan_file: { type: 'string' },
          plan_json: { type: 'string' },
          tasks_count: { type: 'number' },
          message: { type: 'string' }
        }
      },
      render: (v) => JSON.stringify(v, null, 2)
    },
    execute: async (args) => {
      const { payload, formattedTasks } = await syncPlanState({
        plan_id: args.plan_id,
        title: args.title,
        description: args.description,
        status: args.status || 'PENDING_APPROVAL',
        tasks: args.tasks,
        markdown_plan: args.markdown_plan
      });

      return {
        success: true,
        plan_id: payload.plan_id,
        plan_file: MASTER_PLAN_MD,
        plan_json: PLAN_JSON,
        tasks_count: formattedTasks.length,
        message: 'Master Plan salvato su disco (.dsh/tasks/00_master_plan.md) e Plan Sidebar (.dsh/tasks/plan.json) sincronizzata con successo.'
      };
    }
  });

  // --------------------------------------------------------------------------
  // TOOL 2: architect_triage
  // --------------------------------------------------------------------------
  ctx.tools.register({
    name: 'architect_triage',
    description: 'Esegue il triage di complessità e il Gate di Trivialità di The Architect. Se la richiesta è complessa o contiene /architect, propone e pre-inizializza il Master Plan.',
    parameters: {
      user_request: { type: 'string', required: true, description: 'La richiesta espressa dall\'utente' },
      force_mode: { type: 'string', required: false, description: 'Forza la modalità: "fast", "deep", o "auto"' }
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          trivial: { type: 'boolean' },
          reason: { type: 'string' },
          plan_file: { type: 'string' },
          plan_json: { type: 'string' },
          recommendation: { type: 'string' }
        }
      },
      render: (v) => JSON.stringify(v, null, 2)
    },
    execute: async (args) => {
      const mode = args.force_mode || 'auto';
      if (mode === 'auto') {
        const triage = evaluateTriviality(args.user_request);
        if (triage.isTrivial) {
          return {
            path: 'FAST_PATH',
            trivial: true,
            reason: triage.reason,
            recommendation: 'Rispondi istantaneamente all\'utente in modalità conversazionale. NON creare master plan o sub-agenti.'
          };
        }
      }

      // Richiesta complessa: propone la compilazione del Master Plan
      return {
        path: 'MULTI_TASK_PLAN',
        trivial: false,
        reason: 'Compito multi-fase o architettura complessa rilevata.',
        plan_file: MASTER_PLAN_MD,
        plan_json: PLAN_JSON,
        recommendation: 'Invoca immediatamente il tool "architect_create_plan" definendo i task sequenziali e le specifiche per popolare la Plan Sidebar e salvare .dsh/tasks/00_master_plan.md.'
      };
    }
  });

  // --------------------------------------------------------------------------
  // TOOL 2: architect_handoff_brief
  // --------------------------------------------------------------------------
  ctx.tools.register({
    name: 'architect_handoff_brief',
    description: 'Genera il brief di handoff (.dsh/tasks/task_XX_brief.md) per un sub-agente vergine, iniettando L0 (C1-C5) e la Skill L2.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Identificativo task, es. TASK-01' },
      assigned_role: { type: 'string', required: true, description: 'Nome della skill da assegnare (es. curator, auditor, quiz_master, mckinsey-structured)' },
      objective: { type: 'string', required: true, description: 'Obiettivo chiaro e criteri di accettazione del task' },
      input_files: { type: 'array', required: false, description: 'Elenco file di input su disco che il sub-agente deve leggere' },
      output_file: { type: 'string', required: true, description: 'File Markdown in cui depositare il risultato' },
      domain_runner: { type: 'string', required: false, description: 'Runner isolato consigliato: "expo", "go", "rust", "python" o "native"' }
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          brief_path: { type: 'string' },
          status: { type: 'string' }
        }
      },
      render: (v) => JSON.stringify(v, null, 2)
    },
    execute: async (args) => {
      const briefFile = path.join(TASKS_DIR, `task_${args.task_id}_brief.md`);

      // Lettura skill assegnata da .dsh/skills
      let skillContent = '';
      const skillPath = path.join(SKILLS_DIR, `${args.assigned_role}.skill.md`);
      try {
        skillContent = await fs.readFile(skillPath, 'utf8');
      } catch {
        // Fallback su .md generico
        try {
          skillContent = await fs.readFile(path.join(SKILLS_DIR, `${args.assigned_role}.md`), 'utf8');
        } catch {
          skillContent = `Ruolo specialistico: ${args.assigned_role}. Opera come esecutore rigido delle regole di contesto.`;
        }
      }

      // Costruzione del Brief con separazione rigida L0 / L1 / L2
      const briefMarkdown = `# 📋 Task Brief: ${args.task_id}

## L0 - Kernel Invariants & Role Contract (C1–C5)
- **C1 (Routing Fallback):** Se la richiesta fuoriesce dal perimetro assegnato, fermati e ripiega sulla mappa di sistema.
- **C2 (Handoff State):** Scrivi tutto il deliverable in \`${args.output_file}\`. All'avvio leggi solo i file di input dichiarati.
- **C3 (Code-as-Action):** Per manipolazioni pesanti, scrivi script in \`tmp/\`, eseguili e distruggili (Active Oblivion).
- **C4 (Territorial Confinement):** Rispetta rigidamente i confini della directory assegnata dal DAG; non scrivere altrove.
- **C5 (Iterative Guardrails):** Massimo 3 tentativi consecutivi di autocorrezione con il Linter.

---

## L1 - Operational Brief
- **Task ID:** ${args.task_id}
- **Assegnatario:** ${args.assigned_role}
- **Runner Consigliato:** ${args.domain_runner || 'native'}
- **File di Input Autorizzati:** ${(args.input_files || []).join(', ') || 'Nessuno (avvio pulito)'}
- **File di Output Obbligatorio:** ${args.output_file}

### Obiettivo e Criteri di Accettazione
${args.objective}

---

## L2 - Procedural Skill (${args.assigned_role})
${skillContent}
`;

      await fs.writeFile(briefFile, briefMarkdown, 'utf8');
      return {
        brief_path: briefFile,
        output_target: args.output_file,
        status: 'BRIEF_READY'
      };
    }
  });

  // --------------------------------------------------------------------------
  // TOOL 3: architect_linter_audit
  // --------------------------------------------------------------------------
  ctx.tools.register({
    name: 'architect_linter_audit',
    description: 'Esegue il linter deterministico AST/Regex su un file di deliverable con gestione del loop di ripristino (max 3 retry).',
    parameters: {
      result_file: { type: 'string', required: true, description: 'Percorso del file Markdown del risultato da auditare' },
      attempt_number: { type: 'number', required: false, description: 'Numero del tentativo corrente (1, 2 o 3)' }
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          passed: { type: 'boolean' },
          bullet_ratio: { type: 'string' },
          issues: { type: 'array' },
          feedback_prompt: { type: 'string' }
        }
      },
      render: (v) => JSON.stringify(v, null, 2)
    },
    execute: async (args) => {
      const attempt = args.attempt_number || 1;
      const fullPath = path.isAbsolute(args.result_file) ? args.result_file : path.join(WORKSPACE_DIR, args.result_file);

      let content = '';
      try {
        content = await fs.readFile(fullPath, 'utf8');
      } catch (err) {
        return {
          status: 'ERROR',
          passed: false,
          issues: [`Impossibile leggere il file ${args.result_file}: ${err.message}`]
        };
      }

      const audit = auditMarkdownContent(content);

      if (audit.passed) {
        return {
          status: 'PASSED',
          passed: true,
          bullet_ratio: audit.bulletRatio,
          message: 'Deliverable conforme a tutte le invarianti formali e stilistiche.'
        };
      }

      // Se ci sono violazioni:
      if (attempt < 3) {
        const feedback = `LINTER AUDIT FALLITO (Tentativo ${attempt}/3):\n` +
          audit.issues.map((iss, i) => `${i + 1}. ${iss}`).join('\n') +
          '\n\nRiscrivi immediatamente il deliverable sanando queste violazioni.';

        return {
          status: 'RETRY_REQUIRED',
          passed: false,
          attempt_number: attempt,
          bullet_ratio: audit.bulletRatio,
          issues: audit.issues,
          feedback_prompt: feedback
        };
      }

      // Se ha raggiunto il 3° fallimento
      return {
        status: 'FAILED_LINT',
        passed: false,
        attempt_number: attempt,
        bullet_ratio: audit.bulletRatio,
        issues: audit.issues,
        feedback_prompt: 'Raggiunto il limite di 3 tentativi. Blocco dell\'esecuzione autonoma e cessione del controllo al supervisore umano.'
      };
    }
  });

  // --------------------------------------------------------------------------
  // TOOL 4: docker_runner_exec
  // --------------------------------------------------------------------------
  ctx.tools.register({
    name: 'docker_runner_exec',
    description: 'Esegue comandi di test e compilazione all\'interno dei container runner dedicati (Go, Rust, Expo, Python) via socket Docker.',
    parameters: {
      runner: { type: 'string', required: true, description: 'Ambiente di destinazione: "go", "rust", "expo", "python"' },
      cmd: { type: 'array', required: true, description: 'Comando da eseguire come array di stringhe, es: ["go", "test", "./..."]' },
      working_dir: { type: 'string', required: false, description: 'Directory di lavoro all\'interno del container' }
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          container: { type: 'string' },
          exit_code: { type: 'number' },
          stdout: { type: 'string' },
          stderr: { type: 'string' }
        }
      },
      render: (v) => JSON.stringify(v, null, 2)
    },
    execute: async (args) => {
      const runnerKey = args.runner.toLowerCase();
      const containerName = `dsh_runner_${runnerKey}`;

      // Immagini per fallback effimero
      const runnerImages = {
        go: 'golang:1.24-alpine',
        rust: 'rust:1.85-slim',
        python: 'python:3.12-slim',
        expo: 'node:22-alpine'
      };

      // Verifica presenza socket Docker
      try {
        await fs.access(DOCKER_SOCKET);
      } catch {
        return {
          status: 'SKIPPED',
          error: `Socket Docker (${DOCKER_SOCKET}) non disponibile. Esecuzione fallback bare-metal richiesta.`
        };
      }

      try {
        // 1. Verifica se il container preconfigurato esiste e se è avviato
        const inspectRes = await dockerSocketRequest('GET', `/containers/${containerName}/json`);
        const containerExists = inspectRes.status === 200;
        let startedOnDemand = false;

        if (containerExists) {
          const isRunning = inspectRes.data && inspectRes.data.State && inspectRes.data.State.Running;
          if (!isRunning) {
            // Avvio on-demand del container spento
            await dockerSocketRequest('POST', `/containers/${containerName}/start`);
            startedOnDemand = true;
          }

          // 2. Crea ed esegui Exec Instance
          const execConfig = {
            AttachStdout: true,
            AttachStderr: true,
            Tty: false,
            Cmd: args.cmd,
            ...(args.working_dir ? { WorkingDir: args.working_dir } : {})
          };

          const createRes = await dockerSocketRequest('POST', `/containers/${containerName}/exec`, execConfig);
          if (createRes.status !== 201 || !createRes.data.Id) {
            throw new Error(`Impossibile creare exec in ${containerName}: ${JSON.stringify(createRes.data)}`);
          }

          const execId = createRes.data.Id;
          const startRes = await dockerSocketRequest('POST', `/exec/${execId}/start`, { Detach: false, Tty: false });

          // 3. Verifica ExitCode
          const execInspect = await dockerSocketRequest('GET', `/exec/${execId}/json`);
          const exitCode = execInspect.data.ExitCode !== undefined ? execInspect.data.ExitCode : 0;

          // 4. Se è stato avviato on-demand, arrestalo subito per azzerare l'impronta di RAM
          if (startedOnDemand) {
            await dockerSocketRequest('POST', `/containers/${containerName}/stop`).catch(() => {});
          }

          return {
            container: containerName,
            mode: startedOnDemand ? 'ON_DEMAND_LIFECYCLE' : 'EXISTING_RUNNING',
            exit_code: exitCode,
            output: typeof startRes.data === 'string' ? startRes.data : JSON.stringify(startRes.data)
          };
        } else {
          // Nessun container preconfigurato: esecuzione effimera (docker run --rm)
          const image = runnerImages[runnerKey] || 'alpine:latest';
          const ephemeralName = `dsh_ephemeral_${runnerKey}_${Date.now()}`;

          const createEphemeral = await dockerSocketRequest('POST', `/containers/create?name=${ephemeralName}`, {
            Image: image,
            Cmd: args.cmd,
            WorkingDir: args.working_dir || '/workspace',
            HostConfig: {
              AutoRemove: true,
              Binds: [`/workspace/apps:/workspace/apps:rw`]
            }
          });

          if (createEphemeral.status !== 201) {
            throw new Error(`Creazione container effimero fallita: ${JSON.stringify(createEphemeral.data)}`);
          }

          const ephemeralId = createEphemeral.data.Id;
          await dockerSocketRequest('POST', `/containers/${ephemeralId}/start`);

          // Attende completamento
          const waitRes = await dockerSocketRequest('POST', `/containers/${ephemeralId}/wait`);
          const exitCode = waitRes.data.StatusCode || 0;

          // Recupera output logs
          const logsRes = await dockerSocketRequest('GET', `/containers/${ephemeralId}/logs?stdout=true&stderr=true`);

          return {
            container: ephemeralName,
            mode: 'EPHEMERAL_AUTO_REMOVED',
            exit_code: exitCode,
            output: typeof logsRes.data === 'string' ? logsRes.data : JSON.stringify(logsRes.data)
          };
        }
      } catch (err) {
        return {
          container: containerName,
          exit_code: 1,
          error: `Errore durante l'esecuzione su runner: ${err.message}`
        };
      }
    }
  });

  // --------------------------------------------------------------------------
  // TOOL 5: architect_toggle_capabilities
  // --------------------------------------------------------------------------
  ctx.tools.register({
    name: 'architect_toggle_capabilities',
    description: 'Gestisce i toggle di runtime per attivare o disattivare dinamicamente le capacità (Dynamic Tool Pruning).',
    parameters: {
      action: { type: 'string', required: true, description: '"get" per leggere lo stato, "set" per aggiornare' },
      toggles: { type: 'object', required: false, description: 'Oggetto con chiavi booleane (the_architect, graphify_vault, deep_osint, software_factory, persistent_memory)' }
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          capabilities: { type: 'object' },
          tokens_saved_estimate: { type: 'number' }
        }
      },
      render: (v) => JSON.stringify(v, null, 2)
    },
    execute: async (args) => {
      let current = { ...DEFAULT_CAPABILITIES };
      try {
        const raw = await fs.readFile(CONFIG_FILE, 'utf8');
        current = { ...current, ...JSON.parse(raw) };
      } catch {}

      if (args.action === 'set' && args.toggles) {
        current = { ...current, ...args.toggles };
        await fs.writeFile(CONFIG_FILE, JSON.stringify(current, null, 2), 'utf8');
      }

      // Calcola i token stimati risparmiati per ogni modulo spento
      let tokensSaved = 0;
      if (!current.software_factory) tokensSaved += 800; // schemi runner docker rimossi
      if (!current.deep_osint) tokensSaved += 600;       // schemi web search rimossi
      if (!current.graphify_vault) tokensSaved += 500;   // schemi vault linking rimossi
      if (!current.the_architect) tokensSaved += 1200;   // meta-plan orchestrator rimosso

      return {
        capabilities: current,
        tokens_saved_estimate: tokensSaved,
        status: 'UPDATED'
      };
    }
  });

  // --------------------------------------------------------------------------
  // SLASH COMMAND: /architect
  // --------------------------------------------------------------------------
  ctx.inject(['commands'], (cmdCtx) => {
    if (!cmdCtx.commands || typeof cmdCtx.commands.register !== 'function') return;
    cmdCtx.commands.register({
      name: 'architect',
      description: 'Avvia l\'orchestrazione e la pianificazione autonoma con The Architect',
      input: {
        hint: '<descrizione del workflow o architettura>',
        images: false
      },
      handler: async (invocation) => {
        const raw = invocation.rawInput ? invocation.rawInput.trim() : '';
        if (!raw) {
          return {
            kind: 'success',
            text: [
              '🏛️ **The Architect — Autonomous Architecture Engine**',
              '',
              '**Uso:** `/architect <descrizione del workflow o architettura>`',
              '**Esempio:** `/architect Pianifica un workflow per controllare tutte le mattine le notizie di ecologia e produrre un bollettino TL;DR`',
              '',
              'Il comando genera automaticamente il Master Plan formale in `.dsh/tasks/00_master_plan.md` e sincronizza la **Plan Sidebar** con le schede dei task e i controlli del Gate.'
            ].join('\n')
          };
        }

        try {
          invocation.agent.followup(createUserMessage({
            content: [{
              type: 'text',
              text: [
                `[THE ARCHITECT DIRECTIVE - PIANIFICAZIONE RICHIESTA]`,
                `L'utente ha richiesto formalmente tramite /architect la pianificazione del seguente obiettivo:`,
                `"${raw}"`,
                ``,
                `AZIONI OBBLIGATORIE:`,
                `1. NON rispondere con solo testo o spiegazioni discorsive in chat.`,
                `2. Invoca SUBITO il tool 'architect_create_plan' strutturando il piano:`,
                `   - plan_id: "PLAN-01"`,
                `   - title: titolo descrittivo del workflow`,
                `   - description: sintesi dell'obiettivo`,
                `   - status: "PENDING_APPROVAL"`,
                `   - tasks: suddivisione rigorosa in task sequenziali (TASK-01, TASK-02, ...), ciascuno con { id, title, description, assigned_role, runner, deliverable_file, status: "PENDING" }`,
                `   - markdown_plan: documento Markdown completo per .dsh/tasks/00_master_plan.md con Executive Summary, DAG architetturale, specifiche deliverable e Gate 1-3.`,
                `3. Questo salverà il Master Plan su disco e aggiornerà istantaneamente la Plan Sidebar nella UI.`,
                `4. Presenta all'utente una sintesi chiara del piano generato e richiedi l'approvazione del Gate 1 per iniziare l'esecuzione.`
              ].join('\n')
            }],
            source: { kind: 'user' }
          }));
        } catch (err) {
          console.error(`[the-architect] Errore durante l'invio della direttiva agent.followup: ${err.message}`);
        }

        return {
          kind: 'success',
          text: `🏛️ **The Architect**: Ricevuta richiesta di pianificazione per: "${raw}". Inizializzazione del Master Plan e aggiornamento della Plan Sidebar in corso...`
        };
      }
    });
  });

  // --------------------------------------------------------------------------
  // SYSTEM PROMPT: The Architect Operational Invariants
  // --------------------------------------------------------------------------
  ctx.inject(['systemPrompt'], (promptCtx) => {
    if (!promptCtx.systemPrompt || typeof promptCtx.systemPrompt.section !== 'function') return;
    try {
      promptCtx.systemPrompt.section({
        name: 'the-architect:directives',
        order: 10,
        text: [
          '## THE ARCHITECT — OPERATIONAL DIRECTIVES & CAPABILITY SYNTHESIS',
          'You are augmented with The Architect cognitive runtime.',
          'CRITICAL INVARIANTS: Whenever the user mentions "/architect", asks to design or plan a workflow, create a new agent or skill, or structure a multi-step pipeline:',
          '1. NEVER reply with conversational plain text alone.',
          '2. CAPABILITY INTROSPECTION: Analyze whether existing tools, agents, or .dsh/skills already cover the request.',
          '3. EXTERNAL EVALUATION & COMPONENT HARVESTING: When new capabilities are needed, search or evaluate potential plugins/skills (GitHub, claudemarketplaces.com, dsh-plugin.org):',
          '   - Critically assess fitness: does the external plugin fit the exact user need without introducing security risks or context bloat?',
          '   - Component Harvesting: If imperfect or oversized, harvest only the essential building blocks (regex, prompt templates, scripts) to synthesize a clean, bespoke skill or workflow.',
          '   - If offline or no suitable resource exists, engineer the skill from first principles adhering to ICM invariants.',
          '4. MASTER PLAN & SIDEBAR: Decompose into sequential, verified tasks and immediately invoke the tool "architect_create_plan" to populate .dsh/tasks/00_master_plan.md and sync the Plan Sidebar.',
          '5. HANDOFF & COMPLETION: Present the executive summary for Gate 1 approval. Once verified and approved, The Architect completes its mission and cedes execution to worker agents without requiring manual toggle switching.'
        ].join('\n')
      });
    } catch (err) {
      console.error(`[the-architect] Impossibile registrare la sezione systemPrompt: ${err.message}`);
    }
  });
}

export default {
  name,
  inject,
  apply,
  evaluateTriviality,
  auditMarkdownContent
};

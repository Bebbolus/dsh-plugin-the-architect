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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';
const TASKS_DIR = path.join(WORKSPACE_DIR, '.dsh', 'tasks');
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
export const inject = ['tools'];

export function apply(ctx) {
  // Avvia il bootstrap dell'ambiente al caricamento del plugin
  bootstrapEnvironment();

  if (!ctx.tools || typeof ctx.tools.register !== 'function') {
    return;
  }

  // --------------------------------------------------------------------------
  // TOOL 1: architect_triage
  // --------------------------------------------------------------------------
  ctx.tools.register({
    name: 'architect_triage',
    description: 'Esegue il triage di complessità e il Gate di Trivialità di The Architect prima di avviare piani complessi.',
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
      const planFile = path.join(TASKS_DIR, '00_master_plan.md');
      return {
        path: 'MULTI_TASK_PLAN',
        trivial: false,
        reason: 'Compito multi-hop o modifiche strutturali rilevate.',
        plan_file: planFile,
        recommendation: 'Compila .dsh/tasks/00_master_plan.md con i task sequenziali e richiedi l\'avallo dell\'utente prima di spawnare sub-agenti.'
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
      const containerName = `dsh_runner_${args.runner.toLowerCase()}`;

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
        // 1. Crea Exec Instance
        const execConfig = {
          AttachStdout: true,
          AttachStderr: true,
          Tty: false,
          Cmd: args.cmd,
          ...(args.working_dir ? { WorkingDir: args.working_dir } : {})
        };

        const createRes = await dockerSocketRequest('POST', `/containers/${containerName}/exec`, execConfig);
        if (createRes.status !== 201 || !createRes.data.Id) {
          throw new Error(`Impossibile avviare exec in ${containerName}: ${JSON.stringify(createRes.data)}`);
        }

        const execId = createRes.data.Id;

        // 2. Start Exec Instance
        const startRes = await dockerSocketRequest('POST', `/exec/${execId}/start`, { Detach: false, Tty: false });

        // 3. Inspect Exec Instance per ExitCode
        const inspectRes = await dockerSocketRequest('GET', `/exec/${execId}/json`);
        const exitCode = inspectRes.data.ExitCode !== undefined ? inspectRes.data.ExitCode : 0;

        return {
          container: containerName,
          exit_code: exitCode,
          output: typeof startRes.data === 'string' ? startRes.data : JSON.stringify(startRes.data)
        };
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
}

export default {
  name,
  inject,
  apply,
  evaluateTriviality,
  auditMarkdownContent
};

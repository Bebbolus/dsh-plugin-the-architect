/**
 * dsh-plugin-the-architect
 * Cordis Plugin for DeepSeek Harness (DSH)
 * Implementation of the ICM (Interpretable Context Methodology) Runtime,
 * Triage State Machine with Triviality Gate, Zero-Token Handoff,
 * Deterministic 3-Retry AST/Regex Linter, and Ephemeral Docker Runner Control.
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

// Default capability toggles
const DEFAULT_CAPABILITIES = {
  the_architect: true,
  graphify_vault: true,
  deep_osint: false,
  software_factory: true,
  persistent_memory: true
};

/**
 * Native HTTP request over Docker UNIX Socket (zero npm dependencies)
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
 * Initial environment bootstrap for task directories and skill seeds (.dsh/skills)
 */
async function bootstrapEnvironment() {
  try {
    await fs.mkdir(TASKS_DIR, { recursive: true });
    await fs.mkdir(SKILLS_DIR, { recursive: true });

    // If skills directory is empty, seed essential skill blueprints
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

    // Initialize capabilities.json if missing
    try {
      await fs.access(CONFIG_FILE);
    } catch {
      await fs.writeFile(CONFIG_FILE, JSON.stringify(DEFAULT_CAPABILITIES, null, 2), 'utf8');
    }

    // Initialize skills-index.json for lightweight routing
    const skillsList = await fs.readdir(SKILLS_DIR).catch(() => []);
    const indexData = skillsList.filter(f => f.endsWith('.skill.md') || f.endsWith('.md')).map(f => ({
      name: f.replace(/\.skill\.md$|\.md$/, ''),
      path: path.join('.dsh', 'skills', f)
    }));
    await fs.writeFile(path.join(WORKSPACE_DIR, '.dsh', 'skills-index.json'), JSON.stringify(indexData, null, 2), 'utf8');
  } catch (err) {
    console.error(`[the-architect] Bootstrap error: ${err.message}`);
  }
}

/**
 * Triviality Gate: evaluates whether a prompt is quick/conversational or a multi-task project
 */
function evaluateTriviality(prompt) {
  if (!prompt || typeof prompt !== 'string') return { isTrivial: true, reason: 'Empty prompt' };
  
  const p = prompt.toLowerCase();

  // Mandatory keywords that always route through The Architect
  const architectKeywords = [
    '/architect', 'architect', 'architettura', 'workflow', 'pianifica', 'pianificazione',
    'pipeline', 'progetto', 'task', 'piano', 'organizza', 'automazione', 'monitoraggio'
  ];
  for (const akw of architectKeywords) {
    if (p.includes(akw)) {
      return {
        isTrivial: false,
        reason: `Structured architectural intent detected ('${akw}'). Requires Master Plan and Plan Sidebar.`
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
        reason: `Quick conversational query detected ('${kw}'). Bypassing plan factory.`
      };
    }
  }

  // If prompt is very short (< 40 chars) and contains no operational keywords
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

  // 1. Bullet point constraint (< 10% of total lines)
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

  // 2. Emoji prohibition constraint
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  const emojiMatches = content.match(emojiRegex);
  if (emojiMatches) {
    issues.push(`Rilevate emoji nel testo formale ('${emojiMatches[0]}'). Il manifesto formale proibisce severamente l'uso di emoji.`);
  }

  // 3. Isolated meta-cognitive acronym constraint (MECE, SCQA, BLUF, NPOV)
  const forbiddenAcronyms = ['MECE', 'SCQA', 'BLUF', 'NPOV'];
  for (const acr of forbiddenAcronyms) {
    const r = new RegExp(`\\b${acr}\\b`, 'g');
    if (r.test(content)) {
      // Allowed only in header callouts, prohibited in body text
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
  // Initialize environment bootstrap on plugin load
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
      plan_id: { type: 'string', required: true, description: 'Unique plan ID (e.g. "PLAN-01")' },
      title: { type: 'string', required: true, description: 'Descriptive title of workflow or project' },
      description: { type: 'string', required: false, description: 'Sintesi dell\'obiettivo del piano' },
      status: { type: 'string', required: false, description: '"PENDING_APPROVAL", "IN_PROGRESS", "APPROVED", or "COMPLETED"' },
      tasks: {
        type: 'array',
        required: true,
        description: 'Sequential task list: [{ id: "TASK-01", title: "...", description: "...", assigned_role: "curator"|"auditor"|"engineer"|"osint", runner: "native"|"python"|"expo"|"go"|"rust", deliverable_file: ".dsh/tasks/task_01_result.md" }]'
      },
      markdown_plan: {
        type: 'string',
        required: false,
        description: 'Comprehensive formal Markdown content saved to .dsh/tasks/00_master_plan.md (Executive Summary, Architectural DAG, roles, gates).'
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
        message: 'Master Plan saved to disk (.dsh/tasks/00_master_plan.md) and Plan Sidebar (.dsh/tasks/plan.json) synchronized successfully.'
      };
    }
  });

  // --------------------------------------------------------------------------
  // TOOL 2: architect_triage
  // --------------------------------------------------------------------------
  ctx.tools.register({
    name: 'architect_triage',
    description: 'Executes complexity triage and Triviality Gate. If prompt is multi-step or contains /architect, prepares Master Plan initialization.',
    parameters: {
      user_request: { type: 'string', required: true, description: 'La richiesta espressa dall\'utente' },
      force_mode: { type: 'string', required: false, description: 'Force triage mode: "fast", "deep", or "auto"' }
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

      // Complex request: prompts Master Plan creation
      return {
        path: 'MULTI_TASK_PLAN',
        trivial: false,
        reason: 'Multi-phase task or complex architecture detected.',
        plan_file: MASTER_PLAN_MD,
        plan_json: PLAN_JSON,
        recommendation: "Immediately invoke 'architect_create_plan' defining sequential tasks and specifications to populate Plan Sidebar and save .dsh/tasks/00_master_plan.md."
      };
    }
  });

  // --------------------------------------------------------------------------
  // TOOL 2: architect_handoff_brief
  // --------------------------------------------------------------------------
  ctx.tools.register({
    name: 'architect_handoff_brief',
    description: 'Generates zero-token handoff brief (.dsh/tasks/task_XX_brief.md) for worker sub-agent, injecting L0 (C1-C5) and assigned L2 Skill.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Task identifier, e.g. TASK-01' },
      assigned_role: { type: 'string', required: true, description: 'Assigned skill name (e.g. curator, auditor, quiz-master, mckinsey-structured)' },
      objective: { type: 'string', required: true, description: 'Clear goal and acceptance criteria for the task' },
      input_files: { type: 'array', required: false, description: 'Array of disk input filepaths authorized for worker agent' },
      output_file: { type: 'string', required: true, description: 'Target Markdown file to write result to' },
      domain_runner: { type: 'string', required: false, description: 'Recommended runner environment: "expo", "go", "rust", "python", or "native"' }
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

      // Read assigned skill from .dsh/skills
      let skillContent = '';
      const skillPath = path.join(SKILLS_DIR, `${args.assigned_role}.skill.md`);
      try {
        skillContent = await fs.readFile(skillPath, 'utf8');
      } catch {
        // Fallback to generic .md
        try {
          skillContent = await fs.readFile(path.join(SKILLS_DIR, `${args.assigned_role}.md`), 'utf8');
        } catch {
          skillContent = `Specialist role: ${args.assigned_role}. Operate strictly within defined context boundaries.`;
        }
      }

      // Construct brief with rigid L0 / L1 / L2 boundary
      const briefMarkdown = `# 📋 Task Brief: ${args.task_id}

## L0 - Kernel Invariants & Role Contract (C1–C5)
- **C1 (Routing Fallback):** If request falls outside scope, stop and fall back to system map.
- **C2 (Handoff State):** Scrivi tutto il deliverable in \`${args.output_file}\`. All'avvio leggi solo i file di input dichiarati.
- **C3 (Code-as-Action):** Per manipolazioni pesanti, scrivi script in \`tmp/\`, eseguili e distruggili (Active Oblivion).
- **C4 (Territorial Confinement):** Strictly respect directory boundaries assigned by DAG; write nowhere else.
- **C5 (Iterative Guardrails):** Maximum 3 consecutive self-correction retries with Linter.

---

## L1 - Operational Brief
- **Task ID:** ${args.task_id}
- **Assignee:** ${args.assigned_role}
- **Recommended Runner:** ${args.domain_runner || 'native'}
- **Authorized Input Files:** ${(args.input_files || []).join(', ') || 'None (fresh start)'}
- **Target Output File:** ${args.output_file}

### Goal & Acceptance Criteria
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
    description: 'Runs deterministic AST/Regex linter against deliverable file with retry-loop control (max 3 retries).',
    parameters: {
      result_file: { type: 'string', required: true, description: 'Path of result Markdown file to audit' },
      attempt_number: { type: 'number', required: false, description: 'Current attempt count (1, 2, or 3)' }
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
          issues: [`Unable to read file ${args.result_file}: ${err.message}`]
        };
      }

      const audit = auditMarkdownContent(content);

      if (audit.passed) {
        return {
          status: 'PASSED',
          passed: true,
          bullet_ratio: audit.bulletRatio,
          message: 'Deliverable conforms to all formal and stylistic invariants.'
        };
      }

      // If lint violations exist:
      if (attempt < 3) {
        const feedback = `LINTER AUDIT FAILED (Attempt ${attempt}/3):\n` +
          audit.issues.map((iss, i) => `${i + 1}. ${iss}`).join('\n') +
          '\n\nImmediately rewrite deliverable resolving these violations.';

        return {
          status: 'RETRY_REQUIRED',
          passed: false,
          attempt_number: attempt,
          bullet_ratio: audit.bulletRatio,
          issues: audit.issues,
          feedback_prompt: feedback
        };
      }

      // If reached 3rd retry failure
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
      runner: { type: 'string', required: true, description: 'Target environment: "go", "rust", "expo", "python"' },
      cmd: { type: 'array', required: true, description: 'Command array to execute, e.g. ["go", "test", "./..."]' },
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

      // Ephemeral fallback container images
      const runnerImages = {
        go: 'golang:1.24-alpine',
        rust: 'rust:1.85-slim',
        python: 'python:3.12-slim',
        expo: 'node:22-alpine'
      };

      // Check Docker socket availability
      try {
        await fs.access(DOCKER_SOCKET);
      } catch {
        return {
          status: 'SKIPPED',
          error: `Docker socket (${DOCKER_SOCKET}) not available. Bare-metal fallback required.`
        };
      }

      try {
        // 1. Check if configured container exists and is running
        const inspectRes = await dockerSocketRequest('GET', `/containers/${containerName}/json`);
        const containerExists = inspectRes.status === 200;
        let startedOnDemand = false;

        if (containerExists) {
          const isRunning = inspectRes.data && inspectRes.data.State && inspectRes.data.State.Running;
          if (!isRunning) {
            // Start idle container on-demand
            await dockerSocketRequest('POST', `/containers/${containerName}/start`);
            startedOnDemand = true;
          }

          // 2. Create and start Exec Instance
          const execConfig = {
            AttachStdout: true,
            AttachStderr: true,
            Tty: false,
            Cmd: args.cmd,
            ...(args.working_dir ? { WorkingDir: args.working_dir } : {})
          };

          const createRes = await dockerSocketRequest('POST', `/containers/${containerName}/exec`, execConfig);
          if (createRes.status !== 201 || !createRes.data.Id) {
            throw new Error(`Failed to create exec instance in ${containerName}: ${JSON.stringify(createRes.data)}`);
          }

          const execId = createRes.data.Id;
          const startRes = await dockerSocketRequest('POST', `/exec/${execId}/start`, { Detach: false, Tty: false });

          // 3. Inspect exit code
          const execInspect = await dockerSocketRequest('GET', `/exec/${execId}/json`);
          const exitCode = execInspect.data.ExitCode !== undefined ? execInspect.data.ExitCode : 0;

          // 4. If started on-demand, stop it immediately to reclaim RAM
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
          // No configured container found: run ephemeral container (docker run --rm)
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
            throw new Error(`Failed to create ephemeral container: ${JSON.stringify(createEphemeral.data)}`);
          }

          const ephemeralId = createEphemeral.data.Id;
          await dockerSocketRequest('POST', `/containers/${ephemeralId}/start`);

          // Wait for completion
          const waitRes = await dockerSocketRequest('POST', `/containers/${ephemeralId}/wait`);
          const exitCode = waitRes.data.StatusCode || 0;

          // Fetch stdout/stderr logs
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
          error: `Error during runner execution: ${err.message}`
        };
      }
    }
  });

  // --------------------------------------------------------------------------
  // TOOL 5: architect_toggle_capabilities
  // --------------------------------------------------------------------------
  ctx.tools.register({
    name: 'architect_toggle_capabilities',
    description: 'Manages runtime capability toggles to dynamically enable or prune tool definitions (Dynamic Tool Pruning).',
    parameters: {
      action: { type: 'string', required: true, description: '"get" to read current state, "set" to update' },
      toggles: { type: 'object', required: false, description: 'Object with boolean keys (the_architect, graphify_vault, deep_osint, software_factory, persistent_memory)' }
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

      // Estimate saved tokens for disabled capability modules
      let tokensSaved = 0;
      if (!current.software_factory) tokensSaved += 800; // docker runner schemas pruned
      if (!current.deep_osint) tokensSaved += 600;       // web search schemas pruned
      if (!current.graphify_vault) tokensSaved += 500;   // vault linking schemas pruned
      if (!current.the_architect) tokensSaved += 1200;   // meta-plan orchestrator pruned

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
        hint: '<project or workflow description>',
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
              '**Uso:** `/architect <project or workflow description>`',
              '**Example:** `/architect Design an automated morning pipeline to monitor ecology news and produce daily summaries`',
              '',
              'Generates formal Master Plan in `.dsh/tasks/00_master_plan.md` and synchronizes the **Plan Sidebar** with live task cards and Gate controls.'
            ].join('\n')
          };
        }

        try {
          invocation.agent.followup(createUserMessage({
            content: [{
              type: 'text',
              text: [
                `[THE ARCHITECT DIRECTIVE - PLANNING REQUESTED]`,
                `User requested formal project planning via /architect for objective:`,
                `"${raw}"`,
                ``,
                `MANDATORY ACTIONS:`,
                `1. NEVER reply with conversational plain text alone.`,
                `2. IMMEDIATELY invoke tool 'architect_create_plan' with structured parameters:`,
                `   - plan_id: "PLAN-01"`,
                `   - title: descriptive title of workflow`,
                `   - description: summary of the objective`,
                `   - status: "PENDING_APPROVAL"`,
                `   - tasks: rigorous sequential tasks (TASK-01, TASK-02, ...), each with { id, title, description, assigned_role, runner, deliverable_file, status: "PENDING" }`,
                `   - markdown_plan: complete formal Markdown plan for .dsh/tasks/00_master_plan.md (Executive Summary, DAG, deliverable specs, and Gate 1-3).`,
                `3. This saves Master Plan to disk and immediately synchronizes the Plan Sidebar in the web UI.`,
                `4. Present an executive summary and request Gate 1 approval before proceeding.`
              ].join('\n')
            }],
            source: { kind: 'user' }
          }));
        } catch (err) {
          console.error(`[the-architect] Error dispatching agent.followup directive: ${err.message}`);
        }

        return {
          kind: 'success',
          text: `🏛️ **The Architect**: Planning requested for: "${raw}". Initializing Master Plan and synchronizing Plan Sidebar...`
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
      console.error(`[the-architect] Failed to register systemPrompt section: ${err.message}`);
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

# dsh-plugin-the-architect 🏛️

[![npm version](https://img.shields.io/npm/v/dsh-plugin-the-architect.svg)](https://www.npmjs.com/package/dsh-plugin-the-architect)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DSH Plugin Hub](https://img.shields.io/badge/DSH--Plugin-Orchestration-blue.svg)](https://dsh-plugin.org)

The Architect & ICM (Interpretable Context Methodology) Runtime Engine for **DeepSeek Harness (DSH)**.

Headless Cognitive Core (L1 Meta-Director) that enforces deterministic orchestration, external capability evaluation, component harvesting, ephemeral on-demand runner containers, zero-token handoffs, and rigid structural invariants.

---

## 🌟 Key Features

* **Triage State Machine & Fast-Path:** Preliminary prompt analysis via the **Triviality Gate** (Zero-Agent Fast Path for rapid/conversational queries; multi-task orchestration for structured projects).
* **Capability Introspection & External Component Harvesting:**
  - Introspects existing runtime tools and `.dsh/skills/` before creating new workflows.
  - When new capabilities are needed, searches external ecosystems (GitHub, `claudemarketplaces.com`, `dsh-plugin.org`).
  - Evaluates suitability, security, and context cleanliness.
  - **Component Harvesting:** If an external library is oversized or imperfect, harvests only essential regex, prompts, or scripts to engineer a clean, bespoke skill.
  - Autonomous handoff upon user approval without requiring manual toggle manipulation.
* **Zero-Token Handoff:** Hydrates worker sub-agents exclusively through formal Markdown contracts (`task_XX_brief.md`), eliminating conversational noise and context pollution.
* **Deterministic 3-Retry AST/Regex Linter:** Rigorous structural gate rejecting excessive bullet points (>10%), unanchored claims, emoji, or naked meta-cognitive acronyms prior to consolidation in `00_master_plan.md`.
* **5 Operational Invariants (C1–C5):** Automatically injects strict territorial confinement, active oblivion, and centralized map grounding into sub-agent briefs.
* **Ephemeral & On-Demand Docker Runners:** Dynamic lifecycle management for language compilers (`dsh_runner_go`, `dsh_runner_rust`, `dsh_runner_expo`, `dsh_runner_python`) via UNIX socket (`/var/run/docker.sock`). Containers stay stopped by default, start only during execution, and terminate immediately when done.
* **Real-Time Plan Sidebar Synchronization:** Pushes state updates to `plan_sidebar_update` and `.dsh/tasks/plan.json`, reflecting task progress and deliverable previews live in the Web GUI.

---

## 📦 Installation in DeepSeek Harness

Run from your DSH environment:

```bash
dsh plugin --profile web add dsh-plugin-the-architect
```

DSH automatically discovers the `dsh.bundle.patch` declaration in `package.json`, registers the bundle in `dsh.profile.bundles`, and mounts the runtime.

Or configure manually in `cordis.patch.yml`:

```yaml
- insert:
    - id: the-architect
      name: 'dsh-plugin-the-architect'
```

---

## 🛠️ Exposed Tools & Slash Command

### Slash Command
* `/architect <project or workflow description>`: Triggers autonomous planning, initializes `00_master_plan.md`, and syncs the Plan Sidebar.

### LLM Tools
* `architect_create_plan`: Creates structured tasks, updates `00_master_plan.md`, and serializes `plan.json`.
* `architect_triage`: Evaluates task complexity vs conversational triviality.
* `architect_handoff_brief`: Generates isolated zero-token handoff briefs for worker sub-agents.
* `architect_linter_audit`: Deterministically verifies markdown outputs against formal constraints.
* `docker_runner_exec`: Executes commands inside on-demand sandboxed Docker runners.
* `architect_toggle_capabilities`: Updates local capability states.

---

## 🚀 Publishing to dsh-plugin.org & npm

1. **Tag and Release on GitHub:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. **Publish to npm:**
   ```bash
   npm publish --access public
   ```
3. **Registry Discovery:**
   `https://dsh-plugin.org` automatically indexes packages with the `dsh-plugin` keyword and the `dsh.bundle` manifest.

---

## 📄 License

MIT © Bebbolus

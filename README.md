# dsh-plugin-the-architect

The Architect & ICM (Interpretable Context Methodology) Runtime Engine for **DeepSeek Harness (DSH)**.

## Ruolo Architetturale

Questo plugin rappresenta il **Core Cognitivo Headless (L1 Meta-Regia)**:
* **Triage State Machine:** Analisi preliminare con **Gate di Trivialità** (Zero-Agent Fast Path per query semplici).
* **Zero-Token Handoff:** Idratazione dei sub-agenti solo tramite brief Markdown formali (`task_XX_brief.md`), azzerando l'inquinamento della cronologia.
* **Linter AST/Regex Deterministico a 3-Retry:** Blocco rigido su elenchi puntati (>10%), emoji o acronimi nudi prima del consolidamento.
* **5 Invarianti di Ruolo (C1–C5):** Iniezione automatica delle clausole di confinamento territoriale, active oblivion e ripiegamento su mappa centrale.
* **Controllo Runner Docker:** Esecuzione sicura di test e compilazioni nei container dedicati (`dsh_runner_go`, `dsh_runner_rust`, `dsh_runner_expo`, `dsh_runner_python`) via socket UNIX nativo `/var/run/docker.sock`.
* **Integrazione con Plan Sidebar:** Emette `plan.json` e notifica la Plan Sidebar sullo stato dei task.

## Installazione in DSH

In `cordis.patch.yml`:
```yaml
- insert:
    - id: the-architect
      name: 'dsh-plugin-the-architect'
```

## Licenza
MIT

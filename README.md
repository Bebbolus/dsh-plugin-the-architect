# dsh-plugin-the-architect

The Architect & ICM (Interpretable Context Methodology) Runtime Engine for **DeepSeek Harness (DSH)**.

Headless Cognitive Core (L1 Meta-Regia) that enforces deterministic orchestration, ephemeral on-demand runner containers, zero-token handoffs, and rigid structural invariants.

---

## 🏛️ Ruolo Architetturale & Caratteristiche

* **Triage State Machine & Fast-Path:** Analisi preliminare con **Gate di Trivialità** (Zero-Agent Fast Path per query semplici).
* **Zero-Token Handoff:** Idratazione dei sub-agenti solo tramite brief Markdown formali (`task_XX_brief.md`), azzerando l'inquinamento della cronologia.
* **Linter AST/Regex Deterministico a 3-Retry:** Blocco rigido su elenchi puntati (>10%), emoji o acronimi nudi prima del consolidamento finale in `00_master_plan.md`.
* **5 Invarianti di Ruolo (C1–C5):** Iniezione automatica delle clausole di confinamento territoriale, active oblivion e ripiegamento su mappa centrale.
* **Lifecycle Runner Effimeri / On-Demand:** Gestione dinamica dei container runner (`dsh_runner_go`, `dsh_runner_rust`, `dsh_runner_expo`, `dsh_runner_python`) via socket `/var/run/docker.sock`. I container rimangono spenti nel compose; The Architect li avvia su richiesta per eseguire il comando e li spegne immediatamente al termine.
* **Sincronizzazione Real-Time con Plan Sidebar:** Notifica la Plan Sidebar via `plan_sidebar_update` e `.dsh/tasks/plan.json`, consentendo la visualizzazione istantanea nella Web GUI.

---

## 📦 Installazione in DeepSeek Harness

Esegui dal terminale di DSH:

```bash
dsh plugin --profile web add dsh-plugin-the-architect
```

DSH riconosce automaticamente la dichiarazione `dsh.bundle.patch` in `package.json`, inserisce il bundle in `dsh.profile.bundles` del profilo web e applica il patch layer.

Oppure tramite configurazione manuale in `cordis.patch.yml`:
```yaml
- insert:
    - id: the-architect
      name: 'dsh-plugin-the-architect'
```

---

## 🌐 Pubblicazione su dsh-plugin.org & npm

1. **Tag e Release su GitHub:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. **Pubblicazione npm:**
   ```bash
   npm publish --access public
   ```
3. **Indicizzazione:**
   Il marketplace `https://dsh-plugin.org` rileva automaticamente i pacchetti npm con keyword `dsh-plugin` e il manifest `dsh.bundle`.

---

## Licenza
MIT © Bebbolus

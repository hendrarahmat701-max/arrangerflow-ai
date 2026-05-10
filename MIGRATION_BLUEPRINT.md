# MIGRATION & FREE-LOCAL ARCHITECTURE BLUEPRINT: ArrangerFlow AI

**Project:** ArrangerFlow AI  
**Version:** 1.7.0-LOCAL-FOUNDATION  
**Status:** Transition to Offline-First Engineering

---

## 1. OBJECTIVE
To decouple the project from cloud-assisted dependencies and establish a self-contained, machine-readable engineering environment suitable for local development.

---

## 2. SUPERVISORY ISOLATION PRINCIPLE (CRITICAL)
- **Isolated Agent Layer:** The Engineering Agent is an external supervisory layer, not a tightly coupled part of the workstation runtime.
- **Survival Guarantee:** If the ArrangerFlow Core freezes or crashes, the Agent remains active to provide diagnostics and recovery options.
- **Diagnostic Bridge:** Engines emit data to a decoupled monitor rather than maintaining internal-only logs.

---

## 3. INFRASTRUCTURE CONTINUITY
- **Machine-Readable State:** `PROJECT_STATE.json` tracks engine health for future agent context.
- **Offline-First Engines:** MIDI, SF2, and Playback engines must operate without mandatory cloud APIs.
- **Repository-Scoped Memory:** All architectural decisions are persisted within the repository (MD files).

---

## 3. INTERNAL ENGINEERING AGENT (LOCAL)
- **Role:** A technical assistant UI embedded in the workstation to facilitate diagnostics and workflow validation.
- **Execution Policy:** Approval-based command execution (Sandbox-safe).
- **Communication:** Deterministic, report-focused, and diagnostic-aware.

---

## 4. LOCAL STACK STANDARDS
- **Runtime:** Node.js / Vite / React (Functional Offline).
- **Storage:** Local Filesystem / JSON / .AFX Packages.
- **Audio:** Symbolic scheduler linked to local SoundFont resources.

---
*ArrangerFlow AI — Owned by the user, powered by symbolic precision.*

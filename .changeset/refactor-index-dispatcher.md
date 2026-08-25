---
---

Refactor `packages/kobe/src/cli/index.ts` dispatcher and orchestrator bridge.

Replaced the ~150-line `if/else if` subcommand ladder with a `Map`-based command table, splitting the dynamic-import entries into `index-commands.ts` so `index.ts` stays well under the file-size cap. Also extracted the repeated "daemon if running, else local orchestrator" fallback into `withDaemonOrLocal()` in `orchestrator-bridge.ts`, removing the duplicated connect/close + orchestrator construction logic from `index.ts` and `open-dir-cmd.ts`. No CLI behavior changed.

---
"@sma1lboy/rove": patch
---

A tab running a custom engine no longer reads as a bare shell. The process-tree walk that answers "which engine is live in this tab" only ever asked about engines the registry can name without reading state — the built-ins, the shipped catalog, and plugin engines — so an engine you registered yourself in Settings → Engines was invisible to it. Every consumer reads that silence as a positive "no engine here", so a tab with your engine running in it lost its sidebar state dot, stopped reporting turns, and renamed itself `shell 37` mid-session. The walk now takes a second pass over the launch binaries of your registered presets, and a tab already demoted by an earlier probe is renamed by whatever engine is actually running in it. A built-in found under the same shell still wins: a preset is usually a wrapper (`claudecpa` ends up running claude), and the engine underneath is the one carrying history, status and turn knowledge.

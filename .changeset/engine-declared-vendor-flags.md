---
"@sma1lboy/rove": patch
---

Engines declare their own effort flag and system-prompt protocol, so wrapper and contrib engines stop losing settings silently

Three places accepted an engine's declared capability and then dropped it at launch with no error:

- **Reasoning effort was hardcoded to codex.** The gate that validated a level read `effortLevels` off the registry, but the argv that carried it was `if (vendor === "codex")`. An engine declaring `effortLevels` had its level accepted, shown in the TUI and web pickers, and threaded through `/api/engines` — then discarded at spawn, so the user picked "high" and got the default. Engines now declare `effortArgv` alongside `effortLevels`, the same way they already declare `resumeArgv` and `forkArgv`.
- **Both `--append-system-prompt` injections keyed off the literal id `claude`.** A custom preset declaring the claude protocol (a `claudecpa`-style wrapper) got no status protocol — so its card never moved to `in_review` under `experimental.autoStatus` — and no field notes. Both now resolve the preset's protocol, the same fix session ids and forking already received.
- **The web fallback engine list still named only Claude and Codex.** Before `/api/engines` answers, the vendor picker offered two of the four built-ins with no other way to reach Copilot or Kimi.

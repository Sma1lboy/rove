---
"@sma1lboy/rove": patch
---

Retract the unused model catalog, permission-mode list, default-model resolver, and context-window math from the engine capability contract. The native chat composer that read them was removed in the v0.6 port, so the only capability left is each engine's terminal-presentation policy, which the workspace terminal still applies unchanged. The unused `engineLaunchBin` helper goes with it. No user-visible behavior changes.

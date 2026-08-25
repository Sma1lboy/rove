---
"@sma1lboy/rove": patch
---

Respect the active CLI name (`rove` vs `kobe`) in onboarding completions.

`kobe onboarding` no longer hard-codes `rove` in the generated shell completion hook, fish autoload file, or user-facing hints. When the binary is invoked as `kobe`, completions now reference `kobe` consistently.

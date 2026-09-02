---
"@sma1lboy/rove": patch
---

An engine launched behind a long environment prefix is recognized again. A tab identifies which engine is running by walking its process tree and reading each process's executable, skipping the `env`/`node` wrapper and any `VAR=value` assignments in front of the real binary — but that scan stopped after the first four tokens, so a launch line like `env ANTHROPIC_API_KEY=… ANTHROPIC_BASE_URL=… ANTHROPIC_MODEL=… claude` (an `env` wrapper plus three routing vars, exactly how a proxied Claude is started) pushed `claude` past the window and the tab read as a bare shell. That misidentified a live engine as "no engine": the delivery gate then refused to hand a prompt to it. The scan now runs to the first executable-position token however many assignments or wrappers precede it, and still ignores everything after the binary so an engine's own arguments can never masquerade as its identity.

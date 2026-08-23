---
"@sma1lboy/rove": patch
---

Kimi Code sessions now report activity through real hooks: Rove installs a marker-delimited `[[hooks]]` block into `~/.kimi-code/config.toml`, so kimi tabs get the same event-driven working/done/needs-input badges as claude and codex — including interrupts (Kimi fires `Interrupt` instead of `Stop`) and permission prompts.

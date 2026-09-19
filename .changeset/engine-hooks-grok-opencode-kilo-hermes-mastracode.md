---
"@sma1lboy/rove": patch
---

Five more coding CLIs now report their own activity instead of waiting on the poll, and three join the engine catalog.

Grok and Hermes Agent each gained a session hook: the badge still comes from their screen rules, and the hook says which session is live in a worktree. OpenCode and Kilo gained a lifecycle plugin that reports a turn starting, blocking on a permission or a question, failing and finishing — a nested sub-agent finishing no longer marks your own turn complete. MastraCode reports its whole turn lifecycle through hooks, so it needs no screen rules at all.

Hermes, Kilo and MastraCode are new catalog entries, so they appear in the engine selector whenever their binary is on your PATH. Kilo takes its first message by paste, the way OpenCode does.

Every install stays out of the way of a machine that does not have these CLIs: no config directory exists, nothing is written, and no directory is created. Where Rove does write, it writes its own file wherever the CLI allows one — Grok's `hooks/rove.json` and the OpenCode-family plugin module are Rove's outright — and where it has to share, your own entries, other events and other keys survive both install and cleanup. Hermes' `config.yaml` is edited line by line so comments and key order survive; a shape Rove cannot edit without rewriting lines you wrote is reported by `rove doctor` rather than reformatted.

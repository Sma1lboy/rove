---
"@sma1lboy/rove": patch
---

Make engine hooks fire on Windows. The hook commands Rove writes into `~/.codex/hooks.json`, Claude's settings and kimi's config were POSIX single-quoted (`'kobe' 'hook' 'turn-complete' '--engine' 'codex'`), which cmd.exe and PowerShell cannot run — cmd looks for a program named `'kobe'`, PowerShell reads a string literal — so on Windows a codex tab never reported a turn, a badge, or an attention item. Hook commands are now written as bare tokens (`kobe hook turn-complete --engine codex`), which every shell on every platform runs the same way; a token that does need quoting gets the platform's own dialect. Existing installs are rewritten on the next hook install; codex may ask you to trust the changed hooks once.

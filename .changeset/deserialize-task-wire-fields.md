---
"@sma1lboy/rove": patch
---

Fix seven task fields being silently dropped between the daemon and the TUI. `deserializeTask` — the single decode every task the TUI renders passes through — named only 18 of the 25 fields the wire carries, so `command`, `position`, `observedLanguage`, `quotaResume`, `linkedWorkItem`, `prompt` and `baseRef` arrived correctly and were then thrown away. The visible symptom: a task created with `rove api add --command 'claude --dangerously-skip-permissions'` reached the launcher with no command and started the plain vendor default instead, and a quota-paused task could never show its "resumes at …" line. A new compile-time guard test closes the class, so the next field added to the wire breaks the build until the decode carries it too.

---
"@sma1lboy/rove": patch
---

New task is prompt-first. The web's New task opens a New session composer (project and branch chips, a model/effort menu built from the engine registry, a prompt box) and starts the engine in the task's own tab-1 with that prompt, so no empty task exists in between; the TUI's new-task dialog gains a first-message field and shows model and effort. A task's first conversation now lives in the task itself: `tab-new --kind engine` and `send --tab new` use the task's own tab-1 while it has no conversation and spawn a shared child only after that. A first prompt names a placeholder-titled task and a child, the web rail shows the engine's name for the conversation like the TUI, and Claude transcript lookup follows a symlinked worktree base.

Claude now declares effort levels (`--effort low|medium|high|xhigh|max`), so `rove api add --effort` and both new-task surfaces accept an effort for Claude. "Create without starting" in the composer still makes an empty task.

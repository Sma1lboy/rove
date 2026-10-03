---
"@sma1lboy/rove": patch
---

On Windows, closing a tab, deleting a task, or `rove reset` now ends everything the session started. Before, a process whose parent had already exited survived all three: a dev server an engine's Bash tool put in the background, `start /b`, a `detached` node child, or a nested Rove (`dev:sandbox`) an agent launched, with its daemon, PTY host and engine. Windows never reparents, so the `taskkill /T` tree walk could not reach them. Each hosted session now runs inside its own Job Object, and ending the session closes the job. A daemon of the same Rove instance started from inside a tab (an agent's `rove daemon restart`) still outlives the tab. macOS and Linux are unchanged. A running PTY host picks this up after `rove reset`.

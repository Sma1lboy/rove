---
"@sma1lboy/rove": patch
---

Failure messages that name an action instead of stopping at the cause.

The file-tree error labels each carry their own fix now — `not a git
repository — run \`git init\` here, or open a task in a repo`, `git is not on
PATH — install it with your OS package manager` — and `press r to retry` is
hidden beside the two of them a retry can never resolve. "No daemon running"
names `rove daemon restart`, the same command `rove doctor` prescribes for it.
The two terminal-unavailable lines say which shell (`$SHELL`) and where its
error is (`~/.rove/pty.log`).

Worktree, fork and branch toasts no longer stutter: a failed create said
`Couldn't create the worktree: create(): …`, leaking the function that threw.
The four routine failures were a bare passthrough of the daemon's message with
no hint of which of create/delete/toggle/run had failed; each now names the
action and what survived it — `"nightly audit" stays enabled and will keep
firing on schedule`.

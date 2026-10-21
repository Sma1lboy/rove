---
"@sma1lboy/rove": patch
---

In the TUI, the Files pane of a task on another machine now shows that machine's worktree: the file list, its changes in both scopes, and each file's diff, read there through the forwarded `worktree-*` verbs. It refreshes with `r`; the local file watcher is off for it. While that machine is unreachable the pane says so. Also fixed: selecting such a task no longer mounts the local terminal host, which could start an engine on this machine in a directory that only exists over there; the workspace says where it runs instead. Remote terminals in the TUI come next.

---
"@sma1lboy/rove": patch
---

A plugin pane can now name the task it runs in, and a plugin knows when the daemon goes away.

Panes get `ROVE_PLUGIN_TASK_ID` (both openers: `plugin pane open` and the ctrl+e picker), so a pane no longer has to guess its task by matching its cwd against `worktreePath` — a match that is ambiguous for project-main and directory tasks, which share one cwd. `plugin pane open` takes `--task <id>` and prints the same `{ok, clients, title, taskId}` JSON as `api pane-open`, so a caller can tell "no attached UI performed the split" (`clients: 0`) from "opened"; exit 0 alone never said that.

The SDK gains `RoveSocket.onClose(handler)`, called once when the connection dies. A subscriber holds no pending request, so the old socket — which failed only pending requests — told it nothing at all when the daemon crashed, and a hosted pane's PTY outlives the daemon, so the pane kept drawing a frame that looked live. `RoveSocket.hello()` returns the RUNNING daemon's build version and channel list, which is the only way to tell "this host is too old for that channel" from "nothing has happened yet". `openPane()` takes a `taskId` and surfaces `clients`.

PLUGIN-AUTHORING.md's "`command` is always argv: never a shell" now carries its pane exception — panes do run through the user's interactive login shell — and PLUGIN-SDK.md's pane example handles a lost connection instead of modelling the frozen board.

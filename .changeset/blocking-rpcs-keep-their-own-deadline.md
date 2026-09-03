---
"@sma1lboy/rove": patch
---

Stop killing long-running daemon calls at 20 seconds.

Every RPC except six worktree verbs got a 20s client deadline, and blowing it
did more than fail the call: it rejected with "daemon wedged?", force-closed
the socket and dropped every channel subscription. So `rove api prompt`
returned an RPC error at 20s no matter what `--timeout` said, and a `task.land`
on a large repo put the whole workspace into the reconnect path while the
daemon was healthy.

A verb whose contract is to block now says so on its own registry entry
(`blocking: true`, beside `web: true`), and the client reads that set instead
of a hand-kept list far from where verbs are defined. Covers `ui.prompt`,
`task.land`, `workitem.start`, `automation.runNow`, and both deferred-prompt
release paths alongside the worktree verbs. The wedge detector still guards
everything that answers in milliseconds.

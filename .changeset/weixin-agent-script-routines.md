---
"@sma1lboy/rove": patch
---

WeChat can replace a separate assistant bot. `rove weixin agent <task-id>` sends plain (non-command) messages to that task's agent, which answers with the new `rove weixin send`; any script can use `rove weixin send` to message you too. Routines gain `--script`, which runs a shell command with no engine or worktree (stdout is the run's response), and `--notify`, which pushes each run's response and any failure to WeChat.

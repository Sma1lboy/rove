---
"@sma1lboy/rove": patch
---

A custom engine's `engineProtocol.<id>` now reaches workspace trust, first-message delivery and the transcript reader, not just session pinning. A preset declaring the claude protocol reads its history again (so `ctrl+a c` can fork and `rove api read-output --source history` returns real entries) and gets its worktree pre-trusted instead of stopping at claude's trust dialog. A preset declaring the kimi protocol now gets its first message pasted after launch rather than appended to argv, where kimi read it as an unknown subcommand and exited.

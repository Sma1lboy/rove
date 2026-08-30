---
"@sma1lboy/rove": patch
---

Stop spawning a process on every Bash call for a hook that did nothing.

Rove installed a global `PostToolUse` (Bash) observer into `~/.claude/settings.json`
that ran `rove hook worktree-created` after **every Bash call in every Claude
session on the machine**. Its only job was to archive the task pinned to a
removed worktree — and archive was removed in issue #75, so the hook had done
nothing for a while. It still paid a full process spawn each time: ~170ms
measured, against ~30ms for bare `node -e ''`.

The hook is no longer installed, and it is now **uninstalled on every launch**,
so users who already have the entry stop paying for it without doing anything.
The removal touches only Rove's own group — hooks other tools registered under
`PostToolUse`, your own hooks, and every other key in the file are preserved,
including in hand-edited settings files. It is idempotent: when there is nothing
to remove the file is not rewritten. The bundled Claude Code plugin drops the
same hook from its `hooks.json`.

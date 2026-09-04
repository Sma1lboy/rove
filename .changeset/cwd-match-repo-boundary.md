---
"@sma1lboy/rove": patch
---

Stop attributing another repository's engine session to a project. Engine activity hooks are global — they fire for every session on the machine — and the daemon mapped a hook's `cwd` to a task by pure longest-path-prefix, so a session in a *different* git repository nested under a tracked project (a vendored clone under `refs/`, a `.dev-sandbox` checkout, any repo under a `$HOME` scratch shell's directory task) lit that project's activity badge, filled its event feed, fired its plugin events, and billed its tokens in `rove api agent-turns` / `digest`.

A cwd now only matches a task when no git repository boundary sits between the task's worktree and the cwd. Plain subdirectories of the task's own repo still match, and a nested repo that is itself a Rove task still gets its own sessions.

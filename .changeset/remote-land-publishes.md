---
"@sma1lboy/rove": patch
---

Landing a task that lives on another machine now pushes its branch from that machine and opens a pull request, instead of trying to merge into a checkout the hub does not have. `rove api land --task-id <remote task>` and the web's Land on a remote row both do this, and the web's confirm and toast say so, with the PR link. If `gh` is missing, signed out or the remote is not on GitHub, the branch is still pushed and the reason comes back as `prError`. New verb `rove api publish --task-id ID [--remote NAME]` does the same for any task. Sync with base is hidden on remote rows until it can run there.

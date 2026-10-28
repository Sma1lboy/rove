---
"@sma1lboy/rove": patch
---

`rove api pr-attach --url <url|N>` shows a PR on the calling task's row, wherever the PR's branch lives: a main coordinator that opens PRs from hand-made worktrees now lists them with live state in the web PR chip and the TUI sidebar. The daemon polls each attached PR by URL; `rove api publish` attaches the PR it opens.

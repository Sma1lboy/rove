---
"@sma1lboy/rove": patch
---

`rove feedback` (and `rove api feedback`, Settings → Feedback) now files a GitHub issue on the Rove repo through `gh issue create`, labelled by `--kind bug|idea|question` and with an environment block (version, OS, install kind, default engine) appended. When `gh` is missing or signed out it returns a prefilled new-issue link instead of failing. `--category` and the Discussion path are gone. New **Report a problem** entry in the command palette (TUI and web) and in the web Feedback settings starts a conversation that interviews you and files the issue; the rove skill now offers to file anything awkward in Rove.

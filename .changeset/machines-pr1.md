---
"@sma1lboy/rove": patch
---

See every machine you code on in one sidebar. `rove machine add <ssh-target>` registers another computer running Rove; its tasks appear under a row of their own, and a repo you have on both machines reads `kobe` here and `narwhal:kobe` there. A machine that goes offline keeps its rows — greyed, not gone — and reconnects on its own.

Read-only in this release: opening a remote session, and `rove api` verbs aimed at a remote task, arrive next. Those verbs refuse with `NOT_YET_SUPPORTED_REMOTE` rather than quietly running against your local daemon. See `docs/MACHINES.md`.

---
"@sma1lboy/rove": patch
---

Experimental, Linux only: `rove api add --workspace layerfs` gives a task a LayerFS Workspace in a Docker sandbox of its own instead of a git worktree, set up through `experimental.layerfs` in state.json. Its terminals run inside the sandbox at the task's path, `checkpoint` and `rewind` use LayerFS commits, and the new `rove api export-branch` copies the task's git branch into the host repo for landing.

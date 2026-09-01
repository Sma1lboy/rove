---
"@sma1lboy/rove": patch
---

Fold a directory row when you close its last tab, and adopt directories that are really repositories.

Closing a project's last tab folds it out of the sidebar; a directory opened with `rove .` stayed. Same gesture, same shape of row, two outcomes — decided by a row kind the user never picked. A directory folds now too. It needs no way back through the new-task picker the way a project does: `rove .` is the way back, and a directory was never in the saved-repo list to be lost from.

Separately, a `dir` row sitting on a git repository's root is adopted as that repository's project row at startup. `rove .` has routed a repo root to the project path since 0.9.x, but rows created before that kept rendering as a bare path, outside everything written for a project row — the ordering, the pin, and the fold above. Adoption keeps the task's id, so its terminal tabs come with it. A plain folder stays a directory, a scratch shell that happens to sit in a repo stays a scratch shell, and a directory pinned to a SUBDIRECTORY is left alone — opening one is a deliberate choice that adoption would silently widen to the whole repository.

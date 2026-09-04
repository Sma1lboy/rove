---
"@sma1lboy/rove": patch
---

The Changes tab's diff no longer contradicts the list sitting next to it.

An attempt that committed all its work in a repo with no remote showed
`no changes — clean worktree` beside a sidebar row reading `↑1`: no base ref
resolved, so Branch scope was unreachable and `b` was a silent no-op. The base
now falls back to a local `main` or `master`, and when nothing resolves at all
the scope line names that as the reason.

A renamed file's diff shows the rename and the same `+1 −1` as its own row,
rather than the whole file as sixty added lines — restricting the pathspec to
the new path had unpaired the rename. A changed binary and a mode-only change
each state what changed instead of rendering a blank pane, in the single-file
view and in a combined diff's sections. A `git diff` that fails now shows git's
own error with `r` to retry, instead of being reported as the file's current
content or as `no changes in src/`.

A diff taller than the pane no longer paints over the pane's own header and
footer, so a 6000-line diff still names its file and says `q` closes it, and
`0 notes · 0 unsent` no longer arrives as `06notesn· 06unsent`. A combined
diff labels a non-ASCII path as `src/notes 中文.md` rather than printing both
C-quoted sides as raw octal escapes.

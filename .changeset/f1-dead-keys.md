---
"@sma1lboy/rove": patch
---

Fix F1 advertising four dead sidebar keys

- Wire `t` (`sidebar.sort`) to the existing global sort toggle and make the
tree sidebar actually reorder worktrees by recency when the sort is `recent`.
- Remove the unimplemented `i` (live preview), `ctrl+p` (project filter), and
`?` (Tasks-pane legend toggle) rows from the keymap and their i18n strings so
F1 no longer lists chords that do nothing.

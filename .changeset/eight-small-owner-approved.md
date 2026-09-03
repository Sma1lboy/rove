---
"@sma1lboy/rove": patch
---

A batch of small owner-decided changes.

- **The Files pane watches the worktree again.** The watcher had been behind `KOBE_FILETREE_WATCH=1` since the freeze it guarded against was fixed by moving git scans and preview reads off the event loop, and nothing had set that variable since the tmux Ops pane was removed — so the pane only ever repopulated on `r`. It now watches by default; `KOBE_FILETREE_WATCH=0` turns it off on a repo where a recursive watcher costs more than the staleness.
- **`ctrl+a` `p` follows the sidebar cursor.** With the sidebar focused, Create PR now acts on the highlighted row instead of always on the active task, entering that row to deliver the prompt — the rule `ctrl+a` `o` already followed.
- **Land is reachable from a task row.** The sidebar row menu gains "Land into base branch", running the same merge, confirm and cleanup toasts as the Worktrees page's `l`. Withheld from project-main, directory and never-entered rows, where landing has no branch to act on.
- **A wrapper preset learns its protocol once.** When the process walk finds a built-in engine behind one of your registered custom engines, Rove records `engineProtocol.<id>` for the preset rather than re-sniffing on every task, so history, workspace-trust pre-answer and conversation forking start working for the next task too. A protocol you declared yourself is never overwritten.

Internal: one repo-key derivation behind the issues and notes stores, the web Issue types read from the daemon instead of two hand-copies, a round-trip guard for the Issue field allowlist, and test names that say what they assert.

---
"@sma1lboy/rove": patch
---

The whole-worktree diff no longer carries every untracked file in full: a file over 512 KB shows as not diffed, untracked text stops at 1 MB with the remaining files listed by name, and untracked files are read eight at a time. A worktree holding a 21 MB recorded JSON went from a 30 MB, five-second reply that left the web Diff panel on "loading…" to 1 MB in about a second.

Sessions in the same directory share the web diff they last read, so opening a second one shows the diff at once while it rereads.

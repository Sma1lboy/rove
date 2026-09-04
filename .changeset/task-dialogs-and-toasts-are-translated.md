---
"@sma1lboy/rove": patch
---

The task confirm dialogs and action toasts are translated.

Around two dozen user-facing strings — all three destructive confirms on a task
row, and the failure toasts behind delete, create, fork, rename, pin, move,
engine and status changes, the issue chat and the attention inbox — were
written as English literals rather than catalog keys. `check-i18n` compares the
two catalogs, so strings in neither were invisible to it: the gate passed while
a Chinese user got an English dialog mid-delete.

They are catalog keys now, in both locales. While moving them, each failure
also gained the thing it was missing — the state that survived it, so the
message answers whether to retry or to stop worrying:

```
Couldn't delete "web-refactor" — the task and its worktree are untouched: …
Couldn't rename the branch — it stays "feat/parser": …
Couldn't dismiss it — it stays in the inbox: …
```

The onboarding wizard's environment page also picks up the action line the CLI
path already printed. Both halves run the same check; only one said what
unblocks you.

Crossing a breaking version now says what the required `rove reset` costs —
Rove refuses to start until it runs, it stops every live session, and tasks and
worktrees are kept.

---
"@sma1lboy/rove": patch
---

Surface land/delete results as toasts in the Worktrees page

The Worktrees page reported every land outcome (success, merge conflict,
dirty base, cleanup warnings, and failures) through `console.error`, which is
invisible under an alternate screen. Success now shows a green `done` toast,
conflicts/dirty-base/cleanup warnings show a yellow `needs_input` toast, and
failures show a red `error` toast, matching the notification pattern already
used by the sidebar host.

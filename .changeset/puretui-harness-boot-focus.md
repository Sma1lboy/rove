---
"@sma1lboy/rove": patch
---

The PureTUI live capture harness delivers sidebar keys again (issue #12).

Key injection was never broken — since boot started restoring into the last
session (2026-08-09), any boot with a seeded task lands focus on the workspace
pane, so `n`/`j`/Enter dispatched against disabled sidebar bindings and
vanished without an error. The harness now owns the recipe: the create-task
flow settles after each `ctrl+a h` stroke (the pane-focus flip is a React
state update, so a key sent in the same tick hit the old gates), the checked-in
replay spec waits for sidebar hydration before its first flow and for the
post-rename `ROVE` title at boot, and `focusLeftmostPane` is exported for raw
key-driving scripts. A live e2e (`bun run test:replay:e2e` in
`packages/branding`) boots the real TUI with a seeded task and goes red when
the recipe or any layer of the injection path breaks.

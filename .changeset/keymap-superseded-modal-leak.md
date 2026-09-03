---
"@sma1lboy/rove": patch
---

A superseded renderer can no longer register key bindings into the live
renderer's stack. `ensureInstalled` already refused to let a torn-down
renderer's tree steal the `keyInput` listener back, but `useBindings`'s mount
effect inserted unconditionally — so a component that tree mounts LATE (a
dialog opened by a pending timer) landed in the stack *after* the
`stack.length = 0` that was supposed to drop it. One stale `modalOwner`
arriving that way makes `modalActive()` true with nothing left to clear it, and
every raw `keyInput` listener gated on it goes silent — including the terminal
pane's paste forwarder, which then drops the paste before it reaches the PTY.
The mount effect now applies the same superseded-renderer guard as the
listener. Production runs one renderer per process and never supersedes it, so
this only fires where renderers are swapped in-process.

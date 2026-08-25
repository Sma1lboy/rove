---
"@sma1lboy/rove": patch
---

Extract the hosted PTY child-process lifecycle (`spawn`, `startChild`, `onData`, `markExited`, `endChild`) from `daemon/pty-host.ts` into a new `daemon/pty-child-controller.ts`. The controller owns starting the child, folding output into the ring buffer, observing exit, and teardown, while `PtyHost` keeps session registry, client sinks, freeze coordination, and stats. `pty-host.ts` drops from 497 to 419 lines; both files stay well under the 500-line cap.

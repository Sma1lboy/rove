---
"@sma1lboy/rove": patch
---

Extract `XtermTaskPty.refreshSnapshot()` into a dedicated `XtermSnapshotEngine` in `pty-xterm-snapshot.ts`, shrinking `pty-xterm-base.ts` from 500 to 388 lines and restoring headroom under the file-size cap.

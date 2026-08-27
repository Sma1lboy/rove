---
"@sma1lboy/rove": patch
---

Guard the published package's `node-pty` declaration: an architecture test now pins it in `dependencies` (it is the only thing that installs node-pty for the bundled daemon's external import — `@sma1lboy/kobe-daemon` is private and never published), and knip no longer flags it as unused (the dynamic `import("node-pty")` is invisible to static analysis).

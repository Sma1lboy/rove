---
"@sma1lboy/rove": patch
---

A working terminal no longer rewrites its whole scrollback to disk every five seconds

Each hosted PTY session keeps a 512KB ring of scrollback, and persisting it re-encodes and rewrites the entire ring — about 683KB of base64 — however few bytes actually moved. Engines repaint their status line at least once a second while a turn runs, so every session with an agent working in it was doing that twelve times a minute. Measured against real engine output (389-928 bytes a second, sampled from live sessions), that is 2.3 MB/s across 18 working sessions and 0.17 TB written per day; at 200 sessions, 25.6 MB/s.

A periodic freeze now waits until the session has actually produced 64KB, or a minute has passed, whichever comes first. Measured on the same fleet: 0.21 MB/s at 18 sessions (0.015 TB/day), 0.58 at 50, 2.33 at 200 — an 11x cut. A session that really does emit a lot, such as a build log, still writes on the same five-second floor as before.

What this trades: a host that dies without warning — a crash, a reboot, a `kill -9` — now loses up to a minute of the very end of a terminal's scrollback instead of up to five seconds. Every exit, rename and graceful shutdown still writes in full, and the engine's own `--resume` carries the conversation either way.

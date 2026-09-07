---
"@sma1lboy/rove": patch
---

Render at 60fps on Windows and coalesce terminal output every 16ms instead of 33ms. An engine tab on Windows sits behind two ConPTYs — the pty host's and Windows Terminal's — and the inner one already paces its output in 16–60ms batches, so Rove's own 33ms snapshot window plus a 33ms frame on top made typing feel a beat behind a native `claude` in the same terminal. Halving both takes about 33ms off the worst case. macOS and Linux keep 30fps. The snapshot window and the renderer's frame rate now come from one place, so they cannot drift apart.

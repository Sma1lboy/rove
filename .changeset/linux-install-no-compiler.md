---
"@sma1lboy/rove": patch
---

Rove installs on a fresh Linux box without a C++ toolchain. `node-pty` is now an optional dependency: only the Windows PTY host loads it, macOS and Linux run terminals through Bun, and node-pty ships no Linux prebuild, so as a required dependency `npm i -g @sma1lboy/rove` failed compiling a module Linux never uses. Windows installs it exactly as before.

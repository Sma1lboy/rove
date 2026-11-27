---
"@sma1lboy/rove": patch
---

Web: when Rove can't tell an engine's exit code (it ran under a shell, as after `/exit`), the strip over the terminal says "engine exited" instead of "engine exited (code ?)", matching the TUI. The same goes for a session that ended without a known code.

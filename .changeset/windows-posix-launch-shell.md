---
"@sma1lboy/rove": patch
---

Windows: engine tabs no longer fill with PowerShell parse errors when `$SHELL` points at a native shell. Rove's launch script is POSIX sh, so `$SHELL` is now honoured only when it names a POSIX shell; anything else falls back to Git for Windows bash. `rove api send` picked its shell without that check at all, and now shares it.

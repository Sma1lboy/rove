---
"@sma1lboy/kobe": patch
---

A task started with a custom launch command (`add --command` / `set-command`) now actually launches that command in the daemon-backed TUI instead of silently falling back to the vendor's default engine — the client was dropping `command` (along with `position`, `quotaResume`, and `linkedWorkItem`) when reading a task off the daemon wire, so a configured override never reached the launch path.

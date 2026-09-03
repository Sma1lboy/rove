---
"@sma1lboy/rove": patch
---

Routines: no more double run on the DST fall-back day, no more frozen composer, and Run now defers like the schedule does

- A daily routine scheduled in the hour the clock repeats ran **twice** every autumn — two worktrees, two branches, two billed turns — and one scheduled in the hour the clock skips every spring didn't run at all, with nothing in its history to say so. The occurrence search now walks the local calendar instead of stepping fixed epoch minutes, so each wall-clock minute is one firing; a skipped local time fires at the instant the clock jumped to.
- A valid-but-rare expression (`0 0 30 2 *`) no longer stalls the daemon or the TUI. The old minute-by-minute scan did 4.7M date allocations before giving up (~150ms), and the automation composer runs the schedule preview while you type — arrowing the day-of-month past 29 with the month on `2` froze the terminal once per keypress. The scan is day-at-a-time now and gives up in ~1ms.
- Run now on a standing routine whose composer is busy files the prompt in your Inbox, matching what the same firing does on the schedule. It used to record `dispatch_failed` and discard the text.

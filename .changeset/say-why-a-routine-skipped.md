---
"@sma1lboy/rove": patch
---

A skipped routine now says why it skipped. The runner has always captured the
precheck's stdout, stderr, exit code and duration and stored them on the run
record; the Routines page collapsed all four to `#12 skipped_precheck — precheck
exited 1`, leaving you to reconstruct the command by hand — the debugging step
Rove had already done and then discarded. The detail box now shows the exit code,
the duration and the last ten lines of each captured stream under the run list,
for the most recent run. Run rows also carry the trigger: `·` fired by cron,
`▸` run by hand, so a manual test and a scheduled firing stop looking alike.

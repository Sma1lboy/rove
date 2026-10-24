---
"@sma1lboy/rove": patch
---

Sessions survive restarts and can be reopened. A pty host no longer deletes its frozen sessions on a stop (only `rove reset` wipes them) and refuses to stop while it holds live sessions; a client that finds a silent host now refuses to replace it instead of tearing it down. Engines without a session pin flag (omp) now get their hook-reported session id saved on the tab, so a restart resumes the conversation. New `rove api tab-revive` reopens a dead, missing or freeze-restored tab (resuming its conversation when one is recorded), and the web shows a Reopen session button wherever a tab has no running session.

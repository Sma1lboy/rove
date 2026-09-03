---
"@sma1lboy/rove": patch
---

**A PR chip that stopped updating now says so.** When `gh` could not reach GitHub, the poller logged the failure to the daemon log, backed off, and left the chip showing its last reading — with nothing on screen to say the reading was no longer being refreshed. A branch could sit under a green `✓` for hours while polling was broken. The failure is now recorded on the task (`prStatus.lastError`, a field that was declared, persisted and diff-excluded but never written), and the sidebar's PR chip keeps its glyph and drops its colour while it stands: the fact has not changed, but nothing is confirming it any more. The next poll that reaches the provider restores the colour.

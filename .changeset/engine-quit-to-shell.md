---
"@sma1lboy/rove": patch
---

Quitting an engine on purpose (`/exit`, Ctrl+D, Ctrl+C twice) is no longer reported as a crash. The tab stays a shell in the same folder with a dim "Engine ended" line; the row shows no error, nothing goes to the Inbox, and a delivery waiting on that tab is not marked missing. A crash, a kill or a non-zero exit still shows the banner and its actions.

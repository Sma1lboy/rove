---
"@sma1lboy/rove": patch
---

A routine whose engine lost its connection no longer stops firing until someone presses run now. A dropped connection or a provider 5xx is now its own failure class (`transient`): it ends the delivery as `transient-failure`, and neither that nor the tab's error state holds the next scheduled firing, which is the retry. Any other engine failure still waits for a human. The Routines page (TUI detail box, web list row) shows each routine's newest failure, `last failed 3h ago: …`, so an outage that healed itself is still visible.

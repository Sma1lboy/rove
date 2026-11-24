---
"@sma1lboy/rove": patch
---

Acking an Inbox item now calms the task list too. Clearing an error, an exited engine or a question in the Inbox (`d`, ack all, or opening it) stops that row's mark until the engine reports something new; before, the row stayed red after the Inbox was empty. Sessions restored after a reboot or a terminal host crash now show up in the Inbox once each, as "restored after restart", so their red mark can be acked like everything else instead of staying until each tab was opened.

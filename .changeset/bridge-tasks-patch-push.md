---
"@sma1lboy/rove": patch
---

The web client is sent only the task rows that changed, not the whole task list on every change. With 10,000 tasks the list is 5.9 MB and it was pushed to every open browser each time anything moved; a change to one row is now a few hundred bytes. Phones and older web pages keep getting the whole list.

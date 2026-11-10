---
"@sma1lboy/rove": patch
---

The web client's Kanban, Routines and Usage pages stop polling while their browser tab is hidden and read once when it is shown again. A page left open in a background tab kept asking every 5 seconds; one Kanban read of a large board is over 400 KB.

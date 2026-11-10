---
"@sma1lboy/rove": patch
---

The web task list no longer holds a change for up to 250 ms while engines are busy. The bridge used a fixed 250 ms gap between two reads of the list; a read takes 2 ms at the median and 8 ms at worst on a machine with 56 tasks, so the gap is now four times the last read's cost. A tab opened or closed elsewhere also shows sooner: the page reads the tab list at once instead of 300 ms after the change.

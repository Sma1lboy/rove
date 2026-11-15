---
"@sma1lboy/rove": patch
---

The web terminal no longer loses most of its characters after the browser's graphics process resets (a driver restart, sleep and wake, or the browser reclaiming GPU memory): text drawn before the reset came back blank while newly seen characters still drew.

---
"@sma1lboy/rove": patch
---

Web: a page that comes back from sleep or a network change reconnects at once. A socket that went dead without closing (a phone that slept, a frozen server) used to show "connected" while input went nowhere; it is now checked with `hello` when the page becomes visible or goes online, and dropped after 4s without an answer. A page in a long reconnect backoff retries the moment it is visible again instead of waiting up to 15s.

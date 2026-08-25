---
"@sma1lboy/rove": patch
---

Settings covers every engine, not just the four built-ins. Settings → Engines
now lists the contrib catalog and plugin-registered engines alongside the
built-ins and your own — an engine you can pick when creating a task is an
engine whose launch command and display name you can configure. Settings →
Accounts follows the same list: engines without an account detector report
binary discovery only (no more silent absence), and a built-in whose launch
command points at an off-PATH binary no longer reads as "not found".

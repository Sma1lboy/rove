---
"@sma1lboy/rove": patch
---

Fix missing mod panes and hook output on Windows by keeping plugin stdio attached. Stop plugin process trees with taskkill on Windows while preserving POSIX process-group cleanup.

---
"@sma1lboy/rove": patch
---

Terminal tabs are now owned by the daemon. Every TUI, the web, the CLI and other machines change a task's tabs by sending the daemon an operation, and all of them show the one list it keeps. A tab closed in one client disappears from all of them and cannot come back, a tab opened in one shows up in the others at once, and two clients opening tabs at the same moment always get two tabs with different numbers, in the same order everywhere. Which tab you are looking at stays your own.

---
"@sma1lboy/rove": patch
---

Switching tasks re-renders less again. Since terminal tabs moved to the daemon, each switch re-sent the task's unchanged tabs to the sidebar, the inbox and the workspace, adding about two React commits per switch; that no longer happens.

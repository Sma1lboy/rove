---
"@sma1lboy/rove": patch
---

Stop a nested headless engine from reporting its turns as the tab it was launched inside

A tab's identity reaches an engine hook through environment inheritance, so a script running inside a tab that shells out to a headless engine passed that tab's identity down to it. Every one of those subprocesses reported its own finished turn as the tab's own: the completion prompt re-fired once per subprocess long after the user's real turn had ended, and each foreign session's tokens were billed to the tab.

A hook now asks its engine whether the session it fired for is unattended, and drops the event when it is. An explicit `--task-id` is deliberate wiring rather than inheritance, so a wrapper that asked to be counted still is.

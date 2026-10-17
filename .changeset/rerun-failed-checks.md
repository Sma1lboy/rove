---
"@sma1lboy/rove": patch
---

- A task whose pull request checks are red now offers **Re-run failed checks** in its sidebar row menu. It restarts only the failed CI jobs, so a flaky failure can go green again without leaving Rove; checks that did not run on GitHub Actions are named in the toast instead.

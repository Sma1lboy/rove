---
"@sma1lboy/rove": patch
---

[cli] `rove --web --stop` and `--start` stop and start the background web service that `--install` set up, without removing it. A Rove home other than the default (`ROVE_HOME_DIR`) now installs its own service instead of replacing the default one.

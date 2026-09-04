---
"@sma1lboy/rove": patch
---

`rove export` and the daemon-down CLI fallback now honour `ROVE_HOME_DIR` / `KOBE_HOME_DIR`. `TaskIndexStore` resolved its home as `options.homeDir ?? homedir()` and never read the environment, so the two call sites that construct it with no options ignored the override: `rove export` in an isolated home printed the operator's real `~/.rove/tasks.json`, and with the daemon down `add` / `remove` / `adopt` / `rove <path>` wrote their task there instead. The env lookup moved into the constructor, so a call site that forgets to pass a home lands in the right one rather than the machine's.

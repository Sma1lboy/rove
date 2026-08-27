---
"@sma1lboy/rove": patch
---

`rove doctor --fix`: doctor can now remediate what it diagnoses, not just report it. Every finding maps to either a runnable fix or an explicitly manual step. Safe, reversible fixes (`daemon restart` for a stale/dead daemon or dead hook channel, `skill install` for a missing/stale agent skill) execute only after a per-fix y/N confirmation showing the exact command; anything that kills live sessions or needs a human (`rove reset`, engine-tab restarts, installs, logins) is printed but never executed — including everything when there is no TTY. A plain `rove doctor` run now ends with a `--fix` hint when findings have a known remedy.

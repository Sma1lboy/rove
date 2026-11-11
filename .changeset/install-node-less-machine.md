---
"@sma1lboy/rove": patch
---

Fix the install script leaving a Rove that cannot start on a machine with no Node.js (a Steam Deck, a bare Linux box): `rove` failed with `env: 'node': No such file or directory` while the script still printed "rove installed". The script now lets Bun stand in for `node` there, and reports an error when the installed `rove` does not run.

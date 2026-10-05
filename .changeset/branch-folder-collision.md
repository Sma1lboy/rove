---
"@sma1lboy/rove": patch
---

A new task's auto-named branch no longer fails to create when the name clashes with an existing branch's folder: a title like "Fix" in a repo that already has `fix/login` now gets `fix-2`, and `feat/x` in a repo with a plain `feat` branch becomes `feat-x`, instead of git refusing with "cannot lock ref" on every retry.

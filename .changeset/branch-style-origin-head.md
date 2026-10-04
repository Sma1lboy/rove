---
"@sma1lboy/rove": patch
---

Auto-generated branch names follow a typed convention (`feat/…`, `fix/…`) in cloned repos again. Branch-style inference read `origin/HEAD` as an extra branch literally named `origin`, so every clone cast one phantom "bare" vote: a repo with only `main` and `feat/x` named a new task `add-login` instead of `feat/add-login`, and the phantom `origin` also counted as a taken name.

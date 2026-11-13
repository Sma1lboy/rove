---
"@sma1lboy/rove": patch
---

fix(web): a repository picked in New session is cloned into `~/.rove/repos/<host>/<owner>/<name>`, not into your home folder. It is the folder `rove api add --clone` uses, and a repository already cloned there is opened instead of cloned again.

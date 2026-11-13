---
"@sma1lboy/rove": patch
---

`rove --web` started from a directory that has since been deleted shows your sessions again. The page used to list the tasks and leave the session area blank, because every read behind it failed on the missing directory. `rove api` verbs run from a deleted directory work too; only a relative path flag still needs a real directory.

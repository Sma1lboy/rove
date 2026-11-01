---
"@sma1lboy/rove": patch
---

`rove api pr-attach` treats a PR link that differs only in the owner or repo's letter case (`github.com/acme/app/pull/7` after `github.com/Acme/App/pull/7`) as the same PR, as GitHub does, so the row no longer keeps and polls a second copy of it.

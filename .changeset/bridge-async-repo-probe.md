---
"@sma1lboy/rove": patch
---

Picking a repository in the web client's New session page no longer freezes every open browser while git runs. The web bridge ran git synchronously, about 80 ms per pick on a repo with 600 branches, and terminal output and list updates for everyone waited on it. It now runs git in the background, and the pick itself answers in about 45 ms.

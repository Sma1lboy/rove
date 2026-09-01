---
"@sma1lboy/rove": patch
---

Give a dispatched task the reply address in its opening brief.

`rove api send` prefixes a cross-task prompt with who sent it and the exact command to answer. `rove api add --prompt` — which is how one agent starts another — did not, so a task began its work with no idea who dispatched it or how to report back. The sender was recorded as `dispatcher` on the task row, but that is data a receiver has to think to go read, and has no reason to suspect exists.

A task's opening brief is where the reply address matters most: every report it will ever send flows back through it. Both delivery verbs now carry the same prefix, from one shared implementation. A create from a plain shell is unchanged — the prefix only appears when the caller is a verified Rove session, and never when a task addresses itself.

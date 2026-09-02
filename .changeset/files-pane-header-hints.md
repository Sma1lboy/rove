---
"@sma1lboy/rove": patch
---

The Files pane header no longer opens with a two-row hole. Its Zen and Create-PR
chips always wrap (they are wider than the pane), and the row's `gap` was
applying vertically as well as horizontally, so the header spent five rows on
two hints. It now spends two or three. A project's `main` row also stops
offering **Ask agent to create PR** — that row is the repo's own checkout with no
task branch, so the action could only answer with its already-on-the-target-branch
toast. `ctrl+a` `p` still fires there and still says why.

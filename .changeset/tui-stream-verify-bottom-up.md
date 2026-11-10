---
"@sma1lboy/rove": patch
---

A terminal pane uses about 60% less CPU while an agent streams a reply. Each frame the pane checked whether its rows still matched the last drawn frame, from the top row down, so a reply that only rewrites the bottom rows compared every row above them, and all of the scrollback, before reaching the change. The check now starts at the bottom row.

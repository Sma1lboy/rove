---
"@sma1lboy/rove": patch
---

Frame the Kanban board's columns and cards in rounded corners, like every other panel in the TUI.

The workspace pane, files pane and tab strip all draw `╭╮╰╯`; the board's four columns and the cards inside them drew opentui's default square `┌┐└┘`, so the one page reachable from the rail was framed in a different grammar from the pane it renders inside.

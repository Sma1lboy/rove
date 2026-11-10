---
"@sma1lboy/rove": patch
---

A terminal pane uses about 30% less CPU when a program repaints the whole screen every frame, and a little less on a streaming reply. Each changed row used to be packed into a styled-text buffer and laid out again; it is now drawn straight into a one-row cell buffer, and rows that did not change are not touched. The pane also stops rebuilding its 850-entry keybinding signature on every output frame.

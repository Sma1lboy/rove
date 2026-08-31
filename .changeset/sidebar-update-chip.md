---
"@sma1lboy/rove": patch
---

Show an update chip on the sidebar brand row when a newer version is on npm. The daemon has polled the registry and pushed `update` events all along, but the TUI consumer was lost when the tmux runtime was removed (#313), so nothing ever surfaced. The chip (`↑ <version>`) sits right-aligned next to the ROVE brand text, and clicking it — or pressing `u` in the sidebar, as before — opens the update page. This restores the behavior docs/TUI.md already promised under "Updates and version warnings".

---
"@sma1lboy/rove": patch
---

`rove api pane-graphics`: hand opaque graphics bytes to every attached TUI to write to its own terminal, and learn the cell pixel size. A pane's `tty(1)` is its own PTY slave and the outer emulator is scrubbed from its environment, so it can neither reach the real terminal nor measure it; the TUI now asks its terminal for the cell size at boot (`CSI 16 t`) and reports it with its subscribe, and the daemon allocates the per-tab image id — the one number a pane cannot pick for itself. Rove parses none of the payload.

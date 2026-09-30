---
"@sma1lboy/rove": patch
---

Inline images from omp now show in a terminal pane under Ghostty and kitty. Rove lifts Kitty graphics commands out of each pane's output and writes them to your terminal (transmits, virtual placements and deletes by id only; `q=2` forced), answers the pane's `CSI 16 t` cell-size query, and launches omp with `PI_FORCE_IMAGE_PROTOCOL=kitty PI_KITTY_PLACEHOLDERS=1 PI_FORCE_HYPERLINKS=1` when the launching Rove runs in such a terminal.

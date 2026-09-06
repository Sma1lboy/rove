---
"@sma1lboy/rove": patch
---

Stop the Windows TUI from keeping the wreckage of the last screen size.

**A resize now repaints every cell.** Rove's renderer draws each frame by writing only the cells that changed since the last one, and a terminal that reflowed its own grid — on a window resize, a font-size change, a pane split — has moved cells the renderer still believes it owns. Nothing corrected that, so the leftovers survived every later frame: sidebar rows drawn over each other, the quota line on top of the footer, fragments of the pane you already left, and no way back except quitting. Windows now forces one full repaint after every resize, and another whenever the terminal window regains focus, which also covers the reflows that leave the cell grid the same size. macOS and Linux are unchanged.

**`ctrl+a` `r` redraws the screen** (proposed chord — awaiting owner sign-off). It erases the display and repaints every cell, for whatever nothing can detect: another program writing over Rove, a background image bleeding through. Display only — no task, tab, or engine state changes.

**Windows starts opaque.** Windows Terminal ships acrylic and background images on by default, and in transparent mode Rove paints no opaque cell of its own, so anything a frame does not cover shows the wallpaper rather than the previous frame. `transparentBackground` now defaults to `false` on Windows only, and any value you have already chosen — in either direction, on any platform — is left exactly as it was.

Turn-done notifications (the bell and the OSC 9 desktop notification) go through the renderer instead of writing straight to stdout, so they can no longer land in the middle of a frame's escape sequences on the platforms where the native render thread owns the same file descriptor.

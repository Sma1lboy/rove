---
"@sma1lboy/rove": patch
---

Diff review no longer marks notes sent when nothing was delivered.

`s` handed the batch to a send closure that returned nothing whether it pasted or not, so on a Task with no engine session — one `ctrl+w` away — every note was marked sent, the footer dropped to `0 unsent`, the warning paint cleared, and the notes were indistinguishable from delivered ones forever. The engine send and paste closures now report whether they reached a session; a refused send leaves the notes unsent and says why. The FileTree `a` mention went through the same closure and dropped writes the same silent way; it now reports too.

The diff tab also gains `r` to reload the file it is showing (the Files pane next door has had it all along, and the tab is meant to stay open while the engine changes the file), and `x` to drop the note the cursor sits inside.

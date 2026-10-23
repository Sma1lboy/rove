---
"@sma1lboy/rove": patch
---

Ctrl+V in a web task terminal on a Mac now pastes the image on the browser's clipboard: it is stored on the machine running rove and its path is typed in. Before, Ctrl+V reached the engine, which read the clipboard of the machine running rove, so a browser on another machine pasted the wrong image. With no image on the clipboard, or a page that may not read it (plain http, permission refused), it now says so instead.

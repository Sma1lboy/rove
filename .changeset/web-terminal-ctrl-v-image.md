---
"@sma1lboy/rove": patch
---

Ctrl+V in a web task terminal (Mac) now pastes the image on the browser's clipboard: it is stored on the machine running rove and its path is typed in. Before, Ctrl+V reached the engine, which read the clipboard of the machine running rove instead of the browser's. From another machine, a clipboard with no image, or a page that may not read it (plain http, permission refused), now shows why instead of pasting the wrong clipboard; a page opened on the rove machine itself still hands Ctrl+V to the engine.

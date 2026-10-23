---
"@sma1lboy/rove": patch
---

Ctrl+V in a web task terminal now pastes the image on the browser's clipboard: it is stored on the machine running rove and its path is typed in. Before, Ctrl+V reached the engine, which read the clipboard of the machine running rove instead of the browser's. With no image on the browser's clipboard (or no clipboard access, e.g. plain http), Ctrl+V goes to the engine as before.

---
"@sma1lboy/rove": patch
---

On the web, a file opened from Files is a tab in the side panel's Browser, with its path in the address bar, where it used to take a column of its own. Opening another file reuses the tab and Back returns to the previous one; press `+` first to keep two files open in separate tabs. Typing a path inside the task's directory (`/…` or `./…`) into the address bar opens that file. `rove api panel-show --view files --path FILE` opens the file the same way.

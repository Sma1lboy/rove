---
"@sma1lboy/rove": patch
---

`rove --web` has a side panel beside the task terminal. Buttons along its top switch between Files, Diff and Browser, and a button at the top right of the workspace shows or hides it. Opening a file from Files now shows its diff in the Diff view beside the terminal instead of replacing it. Browser has an address bar with back, forward, reload and open in a new tab, and frames https pages and a local dev server when Rove is open on the same machine. The panel remembers its width, the last view and the last address per task. On a phone the Terminal / Files switch gains Diff and Browser. The page's content security policy now allows those frames (`frame-src`); the page itself still cannot be framed.

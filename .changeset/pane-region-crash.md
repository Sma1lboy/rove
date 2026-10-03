---
"@sma1lboy/rove": patch
---

A render error in one part of the window no longer blanks all of Rove. The task list, the workspace, the file tree, and full-window pages each catch their own error and show a card naming what broke, while the rest keeps working. The card clears itself when you pick another task or open another page, and its `[ retry ]` button redraws that part in place. Each error still lands in `~/.rove/client.log` under `[pane-crash]`, now tagged with the part that failed.

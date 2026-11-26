---
"@sma1lboy/rove": patch
---

- New task in the terminal UI is now a page in the content pane instead of a dialog over it, laid out like the web's: a centred title with the animated sky above it, the first message in a box at the bottom with Create inside it, and one row of chips underneath for the project, branch, engine, model and effort. The message is focused when the page opens, however it was opened, so typing what the task is for and pressing `enter` creates it with the defaults on the chips. `tab` or a click opens a chip's picker above the box. The task list stays visible beside the page, and picking another task or pressing `esc` leaves without creating.
- A page shown over a running task no longer carries that task's title and colour on its frame.

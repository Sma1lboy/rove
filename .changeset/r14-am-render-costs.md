---
"@sma1lboy/rove": patch
---

Window the file tree so a large worktree stops laying out every row

Expanding a directory with thousands of files made every cursor move lay out
the whole list. The file tree body now mounts only the rows the viewport can
show, padded above and below so the scrollbar and cursor-follow still see the
full list: on a 5000-file worktree that takes an opentui frame from 17.5ms to
0.6ms and first paint from 155ms to 88ms.

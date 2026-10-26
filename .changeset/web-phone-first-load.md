---
"@sma1lboy/rove": patch
---

Web opens faster on a phone network. `rove --web` now gzips the page's text files (JS, CSS, HTML) for browsers that accept it: the app script goes from 1.18 MB to 349 KB on the wire, and on a throttled Slow-4G phone the task list shows in 2.6s instead of 7.3s. A terminal no longer waits for the 1.2 MB Nerd Font symbols file before painting: text shows within ~0.6s of opening it, and icons redraw in place when the font arrives.

---
"@sma1lboy/rove": patch
---

`tab` in the New task dialog's repo field now COMPLETES the highlighted suggestion instead of leaving the field. Typing `a`, seeing `academic-…` under it and pressing the key that finishes things in every shell used to land you on `from branch` with `a` still in the repo box — the dropdown had no key that finished a suggestion and stayed, so continuing meant clicking back. A second `tab`, with nothing left to complete, advances as before. Browsed directories complete one level DOWN and keep their trailing slash, so repeated `tab` walks a path the way a shell does; saved repos complete to their name and close the dropdown. The Clone tab's parent-directory field walks the same way, since it is the same picker. The walking slash no longer travels with the value, so `/i/rove/` and `/i/rove` file one repo rather than two.

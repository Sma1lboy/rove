---
"@sma1lboy/rove": patch
---

F1's diff-review list names the same six keys the diff footer does.

The footer under a focused diff reads `j/k line · v range · c note · x drop ·
s send · r reload`. `KobeKeymap` carried rows for four of them, so F1 — the
surface a user reaches for when the footer is too terse — listed four and left
`x` (drop the note at the cursor) and `r` (reload the file from disk) findable
only by having already read the footer.

Both are doc-only rows, like the four beside them: no chord is added or moved,
the keys have been registered by `preview-review.tsx` and `preview.tsx` since
they landed. Tagging their registrations with the new ids is what puts them in
the reachability scan, so they appear under `HERE — only in Workspace` exactly
when a focused preview can run them.

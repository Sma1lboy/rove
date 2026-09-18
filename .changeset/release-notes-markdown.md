---
"@sma1lboy/rove": patch
---

Release notes render as markdown on the Update, What's New and version-browser pages

Headings, nested bullets, `code`, fenced blocks and emphasis now render instead of
being flattened to plain text. Links show their label — the PR number, the commit
sha, the author handle — and drop the address, so a bullet's sentence starts at the
left edge rather than behind two full GitHub URLs; the release page is still one
keystroke away on every page that shows notes.

All three pages share one renderer, so they cannot drift apart again.

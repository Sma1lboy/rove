---
"@sma1lboy/rove": patch
---

Rename the `kobe-web` package to `kobe-harness`

The package stopped being a browser dashboard when the native web pages were
removed; what is left is the `/harness` capture page and its PTY sidecar, so
the name now says that. Renaming surfaced a trail of references to files that
went with the dashboard — a doc table pointing at a deleted SPA forwarder and
board chip, two comments describing a web board that no longer sends anything,
and a response shape claiming a client-side mirror that no longer exists — all
of which the rename would otherwise have refreshed into fresh-looking dead
pointers. Six tiptap packages and two testing-library packages went with the
composer and the component tests that used them.

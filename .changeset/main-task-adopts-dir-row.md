---
"@sma1lboy/rove": patch
---

A repo whose directory task already pins its root now gets that row promoted to the
project's main row, instead of a second row beside it.

Both rows pin the same checkout, so the sidebar showed one project header with two rows
carrying the same diff — one labelled by branch (`main`), one by path (`~/i/quill-all`) —
which reads as a duplicate of itself. Promotion keeps the session's id, so its terminal
tabs move under the main row. Scratch rows are never promoted.

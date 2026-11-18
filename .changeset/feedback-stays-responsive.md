---
"@sma1lboy/rove": patch
---

Sending feedback no longer freezes Rove while GitHub files the issue. Before, Settings › Feedback stopped drawing until `gh` answered (so "Submitting…" never showed), and the web Feedback page held up every other request from the browser in the meantime. A second Enter while a report is being filed no longer opens a duplicate issue.

---
"@sma1lboy/rove": patch
---

Fix long `rove api send` messages staying in Codex's input box on Windows. A fixed 150ms pause could send Enter while Codex was still collecting the paste, so Enter became another newline instead of submitting the report. Codex delivery now sends End immediately before Enter, outside the pasted text. End flushes the pending paste without changing its contents, so Enter submits it during a running turn as well as at idle. No footer detection, longer fixed delay, or repeated paste is needed.

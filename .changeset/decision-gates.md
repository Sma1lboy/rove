---
"@sma1lboy/rove": patch
---

Tasks can now ask their owner a question: `rove api gate-raise` opens a decision gate that shows in the Inbox as "decision needed"; Enter opens a dialog to pick an option or write a note, and the answer is pasted back into the task's tab. If the engine isn't running, the answer rides the next `send` or routine firing into that tab. New verbs `gate-raise`, `gate-answer`, `gate-withdraw`, `gates`; `context` lists open gates; repeated `--option` flags are supported.

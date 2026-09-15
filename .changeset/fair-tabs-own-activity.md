---
"@sma1lboy/rove": patch
---

Keep each terminal tab's activity scoped to its own session. A completed tab no longer spins because another tab in the same directory writes a transcript. Tab completion polling and the activity watchdog never borrow another session's transcript when identity is missing, and session changes discard pending completion reads. Task-level events without tab identity no longer light whichever tab happens to be selected.

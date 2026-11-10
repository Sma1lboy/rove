---
"@sma1lboy/rove": patch
---

Agent sessions talk to each other less: a worker that reports on an armed prompt no longer also sends a "succeeded" message, because Rove now pastes one `[ROVE REPORT]` line with the outcome into its dispatcher's tab; coordinators read `context` when they need state instead of at every turn; and a field note is only handed to sessions that start later, so it no longer starts a turn on the repo's main session. A `report --outcome done` from a branch with no commits is now refused the same way an empty "succeeded" message is; pass `--allow-empty` for work that genuinely commits nothing.

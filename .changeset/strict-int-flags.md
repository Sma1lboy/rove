---
"@sma1lboy/rove": patch
---

`rove api` integer flags now reject a malformed value instead of silently coercing it. Previously a typo like `issue-set-status --id 5abc` parsed as `5` and flipped the status of a real, wrong issue, and `add --count 1e3` parsed as `1` and quietly spawned a single task — because `parseInt` stops at the first non-digit. Integer flags (`--count`, `--id`, `--number`, `--limit`, and `--agents claude:2` counts) now require the whole value to be a positive integer and fail loudly with a clear error, matching how every other flag validator already behaves.

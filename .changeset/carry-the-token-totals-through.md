---
"@sma1lboy/rove": patch
---

The footer says what the session has cost. The context collector already parsed
prompt, completion and cache tokens out of the transcript every ten seconds and
dropped four of the seven fields at one line; they now ride the same
`usage.context` read to a `Σ 44k` chip beside `ctx`, and `rove api inspect`
gains a `daemon.contextUsage` section carrying all of them per live session —
the only read that shows the token counts at all. No new poll and no new
arithmetic in the neutral layers: every number is the engine adapter's own.
Cache tokens stay on the wire but out of the `Σ`, because a cached prompt is
reuse and folding it in would read as effort. `EngineUsageSnapshot` loses
`total_speed_tokens_per_second`, which nothing produced and nothing read.

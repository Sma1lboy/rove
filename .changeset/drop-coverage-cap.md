---
"@sma1lboy/rove": patch
---

Drop the `coverage-cap` CI job. `render-track` already runs the same
touched-file coverage gate against render lcov, so the vitest-side job was a
second gate on the same contract — and a second place for an unrelated PR to
go red. The floor still applies; `render-track` is now the only job enforcing
it.

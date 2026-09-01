---
"@sma1lboy/rove": patch
---

Fix the two flaky tests that blocked the v0.9.72 npm publish twice.

Both were fixed-budget bets on async work, and both lost the bet on a loaded
CI runner rather than on any code change:

- `test/render/new-chat-flow.test.tsx` asserted on a frame 60ms after
  `requestNewChat()`, but every open is gated on an async engine probe
  (`availableEngineIds()` — a `which` + `stat` per vendor) that runs before the
  dialog mounts. That took 38ms of the 60ms budget on an idle Mac, so a slower
  runner read the pre-dialog frame, which is blank. All five call sites now wait
  for the dialog's own text with `waitForFrameText`.
- `test/daemon/attention-inbox.test.ts` drove its retention-cap fixture through
  510 `record()` calls, each rewriting the whole store file — ~17.7MB of I/O
  against a 5s timeout. The timeout then abandoned the loop mid-write, so the
  `afterEach` cleanup hit `ENOTEMPTY` on a directory that loop was still writing
  into; one defect, two symptoms. The fixture is now seeded through the store
  file, and only the episodes that actually cross the cap are recorded.

No retries, no bumped timeouts, no skips — tests only.

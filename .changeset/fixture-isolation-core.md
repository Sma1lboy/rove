---
"@sma1lboy/rove": patch
---

Extract shared fixture isolation and seeding primitives

`packages/kobe/scripts/fixture-core.ts` now owns the isolation and seeding
logic that was duplicated across the README capture fixture, the visual CI
fixture, and the dev sandbox. The shared helper pins daemon/PTY socket and
pid paths under the fixture home, scrubs inherited Claude/Rove session
markers, seeds a throwaway git repo, and creates tasks with a real chat tab.

`HOME` policy remains a caller decision: the hero fixture keeps the
operator's `HOME` so the real engine can find credentials, while visual and
sandbox fixtures redirect it for determinism. Every fixture now asserts
isolation via `assertFixtureIsolation`, catching a `.kobe/daemon.sock`
compatibility symlink that points outside the fixture root.

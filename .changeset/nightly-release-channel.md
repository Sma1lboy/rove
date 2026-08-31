---
"@sma1lboy/rove": patch
---

Releases are now batched instead of shipping on every merge to `main`, and there's a new nightly channel for anyone who wants the unbatched stream. Merging a PR banks its changeset; a release happens when the Changesets workflow is run (or `scripts/release.sh`) and consumes everything banked since the last one. `rove update nightly` switches to a daily automated cut of `main` — same test gates as a release, just not reviewed as a set — and `rove update latest` switches back. There's no channel setting to configure: the build you're running is the channel, so update checks follow it and switching is just installing from the other one.

---
"@sma1lboy/rove": patch
---

An idle fleet forks a third as many `git status` processes

The daemon polls `git status` per worktree to draw the sidebar's `+N −M` chips. A fingerprint of the git metadata already relaxes that poll for a worktree nothing has touched, but the floor under it was 15 seconds — so a fully idle fleet still forked 18 processes per worktree every 5 minutes to confirm nothing had changed. Measured at both 20 and 50 worktrees, which is flat per worktree and therefore linear: about 3600 processes per 5 minutes at 200 worktrees.

The floor is now a minute. Measured on the same fleet: 360 → 100 processes per 5 minutes at 20 worktrees, 900 → 250 at 50.

Nothing you watch goes stale for it. A worktree whose git metadata moves, or whose engine is working, still drops to the fast cadence on the very next tick: measured, an idle worktree polled zero times in 30 seconds and then polled 1 second after a file appeared in it. The ahead/behind half of the chip rides ref files the fingerprint sees directly. What can now lag by up to a minute is the changed-file count for a file created in a subdirectory, by hand, in a worktree with no engine running.

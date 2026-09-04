---
"@sma1lboy/rove": patch
---

Stop the daemon burning a quarter of a core on git polls for worktrees nothing changed in. With 19 idle tasks attached, a 62-second window spawned 1280 `git` processes and 14.7s of CPU to publish 19 frames; the same window now spawns 133 and 1.0s.

Three fixes: the background collectors are gated on the channels a client actually subscribed to, so a pane that asked only for `ui-prefs`/`keybindings` no longer starts every poller (194 spawns in 8 seconds became 0); the worktree-changes poll first stats the git files a change would touch and relaxes to a 15-second floor while they and the worktree root hold still; and the behind-base count is memoised on the HEAD/base SHAs read straight off the ref files, which also removes the `rev-parse` ladder the base-ref resolution used to spawn.

Responsiveness is unchanged where it is watched: a worktree whose engine is working keeps the 2-second cadence, and staging, commits, fetches, ref moves and new files in the worktree root are still picked up within one tick.

---
"@sma1lboy/rove": patch
---

Re-shoot the plugin SDK example clips in the real TUI

The old GIFs filmed a shell running `rove api …` and `cat`-ing a log file —
true, but no frame contained the product, and the two examples with the most
to show (a pane, a contributed engine) had no clip at all. Each example is now
recorded where its surface actually appears: the `ctrl+e` picker, a split pane
redrawing off `task.snapshot`, the engine list carrying a plugin's engine,
Settings → Plugins, and a hook's own toast.

Captures ride the same browser-PTY path as the README assets
(`packages/kobe-web/e2e/hero-plugin-demos.ts`), with two guards added along
the way: the hero fixture's daemon socket is now pinned rather than derived,
so a compatibility symlink under `.kobe/` can no longer point a capture at the
operator's live daemon, and a take aborts if the TUI ever displays an e-mail
address — Settings → Engines renders real accounts, since `HOME` stays the
operator's by design.

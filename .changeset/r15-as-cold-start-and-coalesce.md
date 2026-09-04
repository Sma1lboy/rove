---
"@sma1lboy/rove": patch
---

Stop every CLI command from loading the whole TUI before it can answer

`src/cli/index.ts` already imported the heavy subcommands lazily, but the
production build inlined every `await import()` into one 2.7MB file, so
`rove --version` and each `rove api` verb evaluated the TUI, opentui and React
first. The bundle is now code-split — `dist/cli/rove-run.js` is 347 bytes over
141 chunks loaded on demand — taking `--version` from 174ms to 45ms and
`rove api list` from 173ms to 46ms (medians of 7; the Bun startup floor is
35ms). Launching the TUI is barely affected, since it does reach those modules.

Splitting was blocked by `src/product.ts` being a re-export barrel, which makes
Bun 1.3.14 emit two chunks for it and fail the build; it now rebinds its exports
one at a time, with a comment saying why it must stay that way.

Also match the terminal's snapshot coalescing to the renderer's frame period
(16ms to 33ms). At 30fps a snapshot built more often than every 33ms is
committed and laid out for a frame that is never drawn: a pane streaming
200 lines/s built 49 snapshots a second and dropped ~40% of them, and now costs
12.0% of a core instead of 14.7%. Output slower than ~30 lines a second, which
is most engine output, is unchanged.

---
"@sma1lboy/rove": patch
---

`engine-list`'s CLI tests no longer spawn `pi` and `omp` to list their models. The verb attaches each engine's model list, and those two answer by running their own CLI — two real process spawns per call, uncached between calls, which cost four tests ~1.4s each against a 5s timeout and only on a machine that has those CLIs installed. It read as a flake and it blocked a release. The product-side fix (memoizing the per-protocol lookup) is tracked separately.

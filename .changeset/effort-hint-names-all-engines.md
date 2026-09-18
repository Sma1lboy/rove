---
"@sma1lboy/rove": patch
---

The effort-level error hint no longer names codex as the only engine that takes one. `rove api set-effort` / `add --effort` on an engine that declares no reasoning levels used to answer "Only engines with declared levels accept one (codex today)" — a line hard-coded before pi and OMP shipped their own `off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max` levels, so it pointed a user away from two engines that would have accepted a level. The hint is now derived from the engine registry and reads "(codex, pi, omp today)", so it stays correct as engines gain or lose levels. The matching `--effort` help text and the Engines doc's reasoning-effort paragraph, which both claimed pi/OMP take Codex's `none` level (they take `minimal` instead), were corrected to spell out the real per-engine lists.

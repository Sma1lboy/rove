---
"@sma1lboy/rove": patch
---

Fix `rove api send` refusing a live engine tab with NO_ENGINE_TAB when the task's recorded vendor differs from what its tabs actually run (issue #36). The engine-key resolver's fallback was vendor-strict, so a long-lived task pinned to a custom preset (e.g. `claudecpa`) whose `tab-1` had died and whose live tabs launch plain `claude` resolved to no engine at all. It now falls back to any tab running a registered engine — matching what the delivery gate and `--tab tab-N` have always accepted — and picks the lowest-numbered tab so a bare send is deterministic.

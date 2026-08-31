---
"@sma1lboy/rove": patch
---

Fix the workspace crashing with "Maximum update depth exceeded" while deleting tasks.

The status hint row at the bottom of the workspace re-computed its snapshot in an effect with no dependency array, so the effect ran after every render. That hook lives in the footer, which wraps the whole pane tree, so its state update re-renders every sidebar row — and each row bumps the binding-stack version as it registers or unregisters, which re-renders the footer again. Only a value comparison stood between that cycle and an infinite loop, and deleting several tasks in a burst got past it: React tripped its update-depth guard and the pane crashed.

The effect now declares its inputs, so it runs when one of them changes instead of on every render.

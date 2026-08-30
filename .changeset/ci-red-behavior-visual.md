---
"@sma1lboy/rove": patch
---

Fix the CI behavior and visual-ground-truth gates on main (issue #79). The hosted-PTY lifecycle behavior test still asserted the removed archive semantics and raced the daemon's asynchronous delete pipeline; it now polls for the converged deleted state. The visual fixture no longer seeds an engine tab for the fixture task, which CI (no engine binary) booted straight into a code-127 dead-engine state, hiding the sidebar row every journey asserts.

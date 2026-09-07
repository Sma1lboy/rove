---
"@sma1lboy/rove": patch
---

Preserve engine conversations when restoring tabs after a reboot. A restored tab's saved engine identity no longer counts as a live process observation, so the shell startup window cannot erase its session ID and turn it into a plain shell. Codex, Copilot, and Kimi history lookup also matches Windows directories written with native backslashes or Git's forward slashes, keeping recorded conversations eligible for resume. Engines that generate their own session IDs rediscover their conversation when a saved ID is no longer valid, including an ID left over from another engine.

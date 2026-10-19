---
"@sma1lboy/rove": patch
---

Switching a task to another engine now drops the model and effort picked for the old one, so a codex task moved to Claude Code no longer relaunches as `claude --model gpt-5-codex` and fails; pick a model in the same change to keep one.

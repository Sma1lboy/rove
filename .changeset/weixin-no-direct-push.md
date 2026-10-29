---
"@sma1lboy/rove": patch
---

The WeChat bridge no longer messages you on its own. Task status (needs you, ready for review, ready to merge) and new decisions are not pushed anymore; ask with `/status` and `/gates`. A `--notify` routine's report now goes to your WeChat agent as a `[Routine <name> #<run>]` message, and the agent decides whether to tell you.

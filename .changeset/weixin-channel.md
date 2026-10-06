---
"@sma1lboy/rove": patch
---

You can now talk to Rove from WeChat (微信). `rove weixin login` shows a QR code; after you scan it, messaging the bot `status` returns what needs you and what is running, `send <id> <text>` types into a task's agent, and `add <repo> <prompt>` starts a task. The daemon also messages you when a task needs you, is ready for review, or has a PR ready to merge, within 24 hours of your last message to the bot; pushes outside that window go to `~/.rove/weixin/undelivered.jsonl`. Only the account that scanned, plus users you `rove weixin allow`, are answered. The channel ships inside the `rove` CLI. See docs/WEIXIN.md.

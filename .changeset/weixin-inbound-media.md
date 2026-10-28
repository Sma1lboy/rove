---
"@sma1lboy/rove": patch
---

WeChat now carries pictures and files both ways. What you send the bot (pictures, files, videos) is downloaded from WeChat's CDN, decrypted into `~/.rove/weixin/inbox/`, and handed to your WeChat agent as an `[image: <path>]` line it can open; a quoted picture comes along too, and a failed download is reported in the chat while the text still goes through. `rove weixin send --attach <path>` (repeatable) sends a picture, video or any file such as a `.md` back to you, and the agent is told to use it.

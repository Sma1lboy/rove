---
"@sma1lboy/rove": patch
---

The WeChat bridge takes pictures, files and videos. Each one is downloaded from WeChat's CDN, decrypted into `~/.rove/weixin/inbox/`, and handed to your WeChat agent as an `[image: <path>]` line it can open; a quoted picture comes along too. A failed download is reported in the chat and the text still goes through.

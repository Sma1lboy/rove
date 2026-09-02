---
"@sma1lboy/rove": patch
---

Chinese, Japanese and Korean input works again in kitty-protocol terminals (iTerm2 3.5+, kitty, Ghostty, WezTerm). 0.9.8x requested the protocol's "report all keys as escape codes" flag for the ctrl-hold guide, which makes the terminal encode an input-method commit as a text event whose characters travel only under the "report associated text" flag; that flag is now requested too.

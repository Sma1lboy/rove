---
"@sma1lboy/rove": patch
---

Settings can now pick the release channel (stable / next / nightly) in both the TUI and the web, turn the update chip off with a "notify me about new versions" setting (`update.notify`), and check the chosen channel's newest build on the spot. The web's update check used to ask the running build's channel whatever you had picked; it now follows `update.channel`. The old "try the nightly preview" install button is gone: picking a channel only sets it, and `rove update` or the Update page installs.

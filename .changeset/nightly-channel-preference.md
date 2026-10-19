---
"@sma1lboy/rove": patch
---

The nightly preview now publishes every day; a bug in the nightly workflow had stopped every run before it built anything. `rove update --nightly` installs it and `rove update --stable` goes back, and Rove now remembers the channel you picked, so a bare `rove update` and the update check keep following it. Settings → General → Updates shows the channel and has a button to try the nightly preview (or return to stable). The Update page's "Update now" no longer installs a stable release when you follow nightly, and the install and update scripts accept `--nightly` and `--stable`.

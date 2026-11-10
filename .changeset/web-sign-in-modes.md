---
"@sma1lboy/rove": patch
---

Settings → About → Sign-in picks how a browser gets into `rove --web`: None (this computer's own browser needs nothing; a plain local run's default), Password, or Token link only. A password can now be set and changed there, not just with `--set-password`. The choice is `"auth"` in `<home>/.rove/bridge/config.json` (`open`, `password` or `token`) and applies without a restart; it replaces the `requireToken` key, which is still read.

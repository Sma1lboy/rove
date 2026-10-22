---
"@sma1lboy/rove": patch
---

`rove --web --set-password` lets you open the web client on another device with a password instead of the token link. Each login gets its own device token (listed by `--list-devices`, revoked by `--revoke-device` or **Sign out** in Settings), wrong guesses lock one address after 5 tries and all password logins after 20 in a day until `rove --web --unlock`, and `--public-host` now also works without a preset for a plain tunnel to 127.0.0.1.

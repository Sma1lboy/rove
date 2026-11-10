---
"@sma1lboy/rove": patch
---

A plain `rove --web` now lets a browser on the same computer in without the token link or a password, and prints the bare address. Phones, other computers, and anything reached through a preset, `--public-host`, a relay, a non-loopback `--host` or a forwarding proxy still need a token. To ask for the link on this computer too, turn on Settings → About → "Ask for the link on this computer" or set `"requireToken": true` in `<home>/.rove/bridge/config.json`.

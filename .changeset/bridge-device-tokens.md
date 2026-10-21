---
"@sma1lboy/rove": patch
---

Each phone or browser can now have its own token. `rove --web --device <name>` mints that device's token and prints its link. `--revoke-device <name>` revokes it without touching the others, and `--list-devices` lists them. Only a hash of each token is stored, and the shared token and `--rotate-token` work as before. The bridge log names the device on connect. `rove --web --setup` checks for Tailscale and cloudflared and prints the exact commands to reach the bridge from another device; it changes nothing on the machine.

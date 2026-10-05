---
"@sma1lboy/rove": patch
---

Add Rove Mobile, an iPhone remote for Rove, and `rove-bridge`, the opt-in WebSocket gateway it pairs with. Remote access is `--preset tailscale` (tailnet address only) or `--preset cf` (Cloudflare Tunnel, with every connection's Access JWT verified); the bearer token travels only in a header. See docs/IOS.md.

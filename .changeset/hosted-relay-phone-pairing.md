---
"@sma1lboy/rove": patch
---

[web][cli] A phone pairs with `rove --web` from Settings → Connectors → Phone: scan the QR code and it connects through Rove's hosted, end-to-end encrypted relay, with no VPN, tunnel or Cloudflare account to set up. `rove --web --install` keeps the page running as a login service so the phone reaches the computer with no terminal open. `--preset relay` now uses the hosted relay unless `--relay-server` names your own, and pages loaded through a relay no longer stop at "loading rove…".

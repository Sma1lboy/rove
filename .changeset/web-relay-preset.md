---
"@sma1lboy/rove": patch
---

`rove --web --preset relay --relay-server <url>` reaches this machine from a phone browser through a relay-kit Worker on your own Cloudflare account, end-to-end encrypted: the relay sees only ciphertext, and the phone needs no VPN app or Cloudflare Access. The bridge token still applies on top. `--relay-shell <dir>` writes the page the Worker serves, `--rotate-relay` unpairs every relay browser, and `--setup` prints the deploy steps.

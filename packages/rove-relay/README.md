# rove-relay

Rove's hosted relay for `rove --web`: a phone opens Settings → Connectors → Phone's QR code and reaches the computer through it, end-to-end encrypted (docs/WEB.md, "Through an encrypted relay").

`src/index.ts` is relay-kit's Worker (https://github.com/nanami-0713/relay-kit, MIT, `LICENSE-relay-kit`) plus the limits a shared relay needs. The page it serves is `rove-web`'s loader (`dist/relay/index.html`).

Deploy after `bun --filter rove-web build`:

```bash
bun run deploy
```

It goes to `relay.sma1lboy.me` (`wrangler.toml`). The bridge's default lives in one constant, `DEFAULT_RELAY_SERVER` in `packages/rove-bridge/src/cli-args.ts`. Wrangler needs a login that may edit Workers and the zone's DNS; a `CLOUDFLARE_API_TOKEN` in the environment wins over `wrangler login`, so unset it if that token is narrower.

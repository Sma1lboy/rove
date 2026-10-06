# rove-bridge

The Mac-side gateway for the Rove iOS app. It talks to the Rove daemon and PTY Host over their unix sockets and gives a paired phone a fixed list of operations over one WebSocket. It does nothing until you start it. Architecture, protocol and the app itself: [`docs/IOS.md`](../../docs/IOS.md).

```bash
bun install                                   # once, from the repo root
bun run --filter rove-bridge start            # your real Rove home, 127.0.0.1:7878 only
bun run --filter rove-bridge dev              # the dev:sandbox home instead
```

With no flags the bridge listens on `127.0.0.1` only, which reaches the Mac itself and the iOS Simulator. A real phone gets in through one of two presets.

## Every connection, every preset

- The phone sends `Authorization: Bearer <token>`. A token in the URL query is refused (HTTP 401), because tunnels and proxies log URLs.
- The token is in `<ROVE_HOME>/.rove/bridge/token` (mode 0600). It is printed only inside the pairing URL and QR code. The app reads it from there once and stores it in the iOS Keychain.
- `--rotate-token` mints a new token, which unpairs every phone.
- Every refused connection is logged to stderr with the client address and the reason. The token and the JWT are never logged.

## Preset 1: Tailscale

Traffic stays inside your tailnet and is encrypted by WireGuard.

1. Install Tailscale on the Mac and the iPhone, and sign both into the same tailnet.
2. Check that the Mac has an address: `tailscale ip -4` prints `100.x.y.z`.
3. Start the bridge:

   ```bash
   bun run --filter rove-bridge start -- --preset tailscale
   ```

   It listens on the Tailscale address only. If `tailscale ip -4` prints nothing, the bridge exits with an error; it never falls back to `0.0.0.0`.
4. Scan the printed QR code in the app (or paste the URL); the app files it under **direct**. The URL uses the MagicDNS name when there is one: `ws://mac.tailXXXX.ts.net:7878/?token=…&preset=tailscale`.

### Optional: wss:// with `tailscale serve`

If MagicDNS and HTTPS certificates are enabled for your tailnet (admin console → DNS), Tailscale can terminate TLS in front of the bridge:

```bash
tailscale serve --bg http://$(tailscale ip -4):7878
bun run --filter rove-bridge start -- --preset tailscale --public-host mac.tailXXXX.ts.net
```

The pairing URL becomes `wss://mac.tailXXXX.ts.net/?token=…&preset=tailscale`. `tailscale serve status` shows the mapping; `tailscale serve reset` removes it.

## Preset 2: Cloudflare Tunnel + Cloudflare Access

The phone reaches a public `wss://` hostname. Cloudflare Access lets in only requests that carry your service token. `cloudflared` forwards them to the bridge on `127.0.0.1`. The bridge then checks the Access JWT and the bearer token; both must pass.

You need a Cloudflare account with a domain on it, and `cloudflared` (`brew install cloudflared`).

### 1. Create the tunnel

```bash
cloudflared tunnel login                                   # pick the zone in the browser
cloudflared tunnel create rove-bridge                      # prints the tunnel UUID
cloudflared tunnel route dns rove-bridge rove.example.com  # CNAME rove.example.com → the tunnel
```

Write `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /Users/<you>/.cloudflared/<TUNNEL-UUID>.json
ingress:
  - hostname: rove.example.com
    service: http://127.0.0.1:7878
  - service: http_status:404
```

WebSockets pass through tunnels without extra settings.

### 2. Create a service token for the phone

Cloudflare Zero Trust dashboard → **Access → Service Auth → Service Tokens → Create Service Token**. Name it (`rove-phone`) and save the **Client ID** and **Client Secret**. The secret is shown only once.

### 3. Create the Access application

Zero Trust → **Access → Applications → Add an application → Self-hosted**.

1. Application domain: `rove.example.com`.
2. Add a policy with **Action: Service Auth** and an **Include** rule of type **Service Token** set to `rove-phone`. A policy with Action *Allow* would send the phone to a login page instead.
3. Save. On the application's overview, copy the **Application Audience (AUD) Tag**.

Your team domain is `<team>.cloudflareaccess.com`. The team name is under Zero Trust → Settings → Custom Pages.

### 4. Start the bridge and the tunnel

```bash
bun run --filter rove-bridge start -- --preset cf \
  --cf-team <team> --cf-aud <AUD-tag> --public-host rove.example.com
cloudflared tunnel run rove-bridge          # in another terminal, or as a service
```

To skip the flags, put them in `<ROVE_HOME>/.rove/bridge/config.json`:

```json
{ "cfTeam": "<team>", "cfAud": "<AUD-tag>", "publicHost": "rove.example.com" }
```

Flags override the file. The bridge listens on `127.0.0.1` only. It fetches the signing keys from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` and checks each request's `Cf-Access-Jwt-Assertion`: signature, issuer, AUD, and expiry. A failure is HTTP 401 plus a log line.

### 5. Pair the phone

In the app choose the **Cloudflare** preset, scan or paste `wss://rove.example.com/?token=…&preset=cf`, and fill in **CF-Access-Client-Id** and **CF-Access-Client-Secret** from step 2. The app sends both headers and the bearer token on every connection. All three are stored in the Keychain.

To check from the Mac:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://rove.example.com/
# 302 or 403 from Cloudflare: Access blocks requests without the service token
```

## Flags

| Flag | Meaning |
| --- | --- |
| `--preset tailscale` | Listen on the Tailscale IPv4 only; pair over MagicDNS (or `--public-host` with `tailscale serve`). |
| `--preset cf` / `cloudflare` | Listen on 127.0.0.1; require Cloudflare Access. Needs `--cf-team`, `--cf-aud`, `--public-host`. |
| `--host <addr>` | Without a preset: an explicit listen address (repeatable). Plain `ws://`, so only for trusted networks. |
| `--port <n>` | TCP port, default 7878. |
| `--public-host <name>` | Hostname the phone dials over `wss://`. |
| `--cf-team <team>` / `--cf-aud <tag>` | Cloudflare Access team and application AUD. |
| `--rotate-token` | New token; every phone must pair again. |
| `--no-qr` | Print the pairing URL without a QR code. |

## Develop

```bash
bun run --filter rove-bridge test        # bun:test
bun run --filter rove-bridge typecheck
```

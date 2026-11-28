/** `--setup`: the ways a phone can reach this bridge, checked against this machine. */

import { spawnSync } from "node:child_process"

/**
 * `--setup`: what reaching this bridge from a phone takes, checked against this machine. It only
 * reads (`tailscale status`, `cloudflared --version`) and prints commands; it exposes nothing.
 */
export function printSetup(port: number): void {
  const has = (cmd: string, args: readonly string[]) => {
    const res = spawnSync(cmd, args, { encoding: "utf8" })
    return res.status === 0 ? (res.stdout ?? "").trim() : null
  }
  const ts = has("tailscale", ["status", "--json"])
  const cf = has("cloudflared", ["--version"])
  const lines = ["Reaching this bridge from another device:", ""]
  if (ts) {
    lines.push(
      "  Tailscale is up here. Private to your tailnet:",
      `    rove --web --preset tailscale --port ${port}`,
      "  With HTTPS on your MagicDNS name (needed for a phone browser):",
      `    tailscale serve --bg ${port}   then   rove --web --preset tailscale --public-host <this-machine>.<tailnet>.ts.net`,
    )
  } else lines.push("  Tailscale: not running here (https://tailscale.com/download), the simplest private path.")
  lines.push("")
  if (cf) {
    lines.push(
      `  cloudflared is installed (${cf.split("\n")[0]}). Behind Cloudflare Access:`,
      `    cloudflared tunnel --url http://127.0.0.1:${port}   (or a named tunnel to your hostname)`,
      "    rove --web --preset cf --public-host <hostname> --cf-team <team> --cf-aud <aud>",
    )
  } else lines.push("  cloudflared: not installed; only needed to publish through Cloudflare Access.")
  lines.push(
    "",
    "  Relay, end-to-end encrypted (no VPN, no Access; the relay sees only ciphertext). Nothing to set up:",
    "  open Settings → Connectors → Phone in the page and scan the QR code, or run",
    "    rove --web --preset relay",
    "  Keep it reachable with no terminal open: rove --web --install",
    "  To use your own relay instead, deploy relay-kit's Worker to your Cloudflare account once:",
    "    git clone https://github.com/nanami-0713/relay-kit && cd relay-kit/workers/relay",
    "    rove --web --relay-shell public",
    `    printf '\\n[assets]\\ndirectory = "public"\\n' >> wrangler.toml`,
    "    npx wrangler login && npx wrangler deploy",
    "    rove --web --preset relay --relay-server https://<worker>.<account>.workers.dev",
    "  *.workers.dev is blocked on many mainland China networks: bind a custom domain (wrangler.toml).",
    "  Redo --relay-shell + deploy only when the page changes; the app itself loads from this machine.",
  )
  lines.push("", "  Give each phone its own token: rove --web --device <name>; revoke one with --revoke-device <name>.")
  console.log(lines.join("\n"))
}

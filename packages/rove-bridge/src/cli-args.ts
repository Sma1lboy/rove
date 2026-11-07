/**
 * Bridge argv → where to listen and how the phone reaches it. Pure: the
 * Tailscale address lookup and the saved config are injected, so every rule
 * here is testable without a tailnet.
 */

export type Preset = "none" | "tailscale" | "cf" | "relay"

export interface CloudflareAccess {
  /** `https://<team>.cloudflareaccess.com` — the JWT issuer and certs host. */
  readonly teamDomain: string
  /** The Access application's AUD tag. */
  readonly aud: string
}

export interface BridgeArgs {
  readonly preset: Preset
  /** Interfaces to listen on. */
  readonly hosts: readonly string[]
  readonly port: number
  /** Where the phone dials, when that is not the listen address (MagicDNS, a tunnel hostname). */
  readonly publicHost: string | null
  /** `wss://` when TLS terminates in front of the bridge (Cloudflare, `tailscale serve`). */
  readonly tls: boolean
  readonly cloudflare: CloudflareAccess | null
  /** `--preset relay`: the relay-kit Worker's origin (`https://relay.example.com`). */
  readonly relayServer: string | null
  readonly rotateToken: boolean
  /** Mint a new relay pairing code, unpairing every browser paired through the relay. */
  readonly rotateRelay: boolean
  /** `--relay-shell <dir>`: where to write the page the relay Worker serves. */
  readonly relayShellDir: string | null
  readonly qr: boolean
  /** Print a link carrying this device's own token (minted on first use) instead of the shared one. */
  readonly device: string | null
  /** One-shot actions that print and exit instead of serving. */
  readonly action:
    | "serve"
    | "list-devices"
    | "revoke-device"
    | "setup"
    | "set-password"
    | "clear-password"
    | "unlock"
    | "relay-shell"
}

/** `<ROVE_HOME>/.rove/bridge/config.json`; flags override it. `publicHost` applies to `--preset cf` only. */
export interface BridgeConfig {
  readonly cfTeam?: string
  readonly cfAud?: string
  readonly publicHost?: string
  readonly relayServer?: string
}

export interface TailscaleInfo {
  readonly ipv4: string | null
  readonly dnsName: string | null
}

export const DEFAULT_BRIDGE_PORT = 7878

export const BRIDGE_USAGE = `usage: rove-bridge [--preset tailscale|cf|relay] [--host <addr>]... [--port <n>]
                  [--public-host <name>] [--cf-team <team>] [--cf-aud <aud>]
                  [--relay-server <url>] [--rotate-relay] [--relay-shell <dir>]
                  [--rotate-token] [--no-qr] [--device <name>]
                  [--list-devices] [--revoke-device <name>] [--setup]
                  [--set-password] [--clear-password] [--unlock]

  (no preset)          listen on 127.0.0.1 only (or each --host you name). With
                       --public-host <name> (a tunnel to 127.0.0.1 serving https://<name>)
                       the links name it and a page from that origin is accepted.
  --preset tailscale   listen on this Mac's Tailscale IPv4 only; fails if Tailscale
                       is not up. With --public-host <name> (a \`tailscale serve\`
                       HTTPS name) the phone dials wss://<name>.
  --preset cf          listen on 127.0.0.1 for cloudflared; every connection must
                       carry a valid Cloudflare Access JWT. Needs --public-host
                       (the tunnel hostname), --cf-team and --cf-aud.
  --preset relay       \`rove --web\` only: listen on 127.0.0.1 and dial out to a relay-kit
                       Worker (--relay-server <url>); the browser reaches this machine
                       through it, end-to-end encrypted. The bearer token still applies.
  --rotate-relay       mint a new relay pairing code, unpairing every relay browser
  --relay-shell <dir>  write the page the relay Worker serves (index.html), then exit
  --port <n>           TCP port (default ${DEFAULT_BRIDGE_PORT})
  --rotate-token       mint a new pairing token, revoking every paired phone
  --no-qr              print the pairing URL without a QR code
  --device <name>      give this phone/browser its own token and print its link;
                       revoke it alone later with --revoke-device <name>
  --list-devices       show the devices that have their own token, then exit
  --revoke-device <n>  revoke one device's token (others keep working), then exit
  --setup              check Tailscale / cloudflared here and print the exact
                       commands to reach this bridge from a phone; changes nothing
  --set-password       prompt (twice, no echo) for a browser login password; the page
                       then offers a password field that mints its own device token.
                       Also lifts a lockout. Never taken from argv or the environment.
  --clear-password     remove the browser login password, then exit
  --unlock             lift a password-login lockout, then exit

  --cf-team, --cf-aud, --public-host and --relay-server may also live in
  <ROVE_HOME>/.rove/bridge/config.json as cfTeam, cfAud, publicHost, relayServer.`

/** `myteam`, `myteam.cloudflareaccess.com` or its https URL → the issuer origin. */
export function teamDomainOf(team: string): string {
  const bare = team
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
  if (!/^[A-Za-z0-9-]+(\.cloudflareaccess\.com)?$/.test(bare)) {
    throw new Error(`--cf-team must be a team name or <team>.cloudflareaccess.com, got ${team}`)
  }
  return `https://${bare.endsWith(".cloudflareaccess.com") ? bare : `${bare}.cloudflareaccess.com`}`
}

/** The relay Worker's origin; plain http only for a loopback relay (tests, `wrangler dev`). */
export function relayOriginOf(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error(`--relay-server must be a URL like https://relay.example.com, got ${raw}`)
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost"
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`--relay-server must be https:// (http:// only for 127.0.0.1 or localhost), got ${raw}`)
  }
  return url.origin
}

export function parseBridgeArgs(
  argv: readonly string[],
  deps: { config?: BridgeConfig; tailscale?: () => TailscaleInfo } = {},
): BridgeArgs {
  const config = deps.config ?? {}
  const hosts: string[] = []
  let preset: Preset = "none"
  let port = DEFAULT_BRIDGE_PORT
  let publicHost: string | null = null
  let cfTeam = config.cfTeam
  let cfAud = config.cfAud
  let relayServer = config.relayServer
  let rotateToken = false
  let rotateRelay = false
  let relayShellDir: string | null = null
  let qr = true
  let device: string | null = null
  let action: BridgeArgs["action"] = "serve"
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = (): string => {
      const v = argv[++i]
      if (v === undefined || v.startsWith("--")) throw new Error(`${arg} needs a value\n${BRIDGE_USAGE}`)
      return v
    }
    if (arg === "--host") hosts.push(value())
    else if (arg === "--preset") {
      const p = value()
      if (p === "tailscale") preset = "tailscale"
      else if (p === "cf" || p === "cloudflare") preset = "cf"
      else if (p === "relay") preset = "relay"
      else throw new Error(`--preset must be tailscale, cf or relay, got ${p}`)
    } else if (arg === "--port") {
      const raw = value()
      port = Number(raw)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port must be 1..65535, got ${raw}`)
    } else if (arg === "--public-host") publicHost = value()
    else if (arg === "--cf-team") cfTeam = value()
    else if (arg === "--cf-aud") cfAud = value()
    else if (arg === "--relay-server") relayServer = value()
    else if (arg === "--rotate-relay") rotateRelay = true
    else if (arg === "--relay-shell") {
      relayShellDir = value()
      action = "relay-shell"
    } else if (arg === "--rotate-token") rotateToken = true
    else if (arg === "--no-qr") qr = false
    else if (arg === "--device") device = value()
    else if (arg === "--list-devices") action = "list-devices"
    else if (arg === "--revoke-device") {
      device = value()
      action = "revoke-device"
    } else if (arg === "--setup") action = "setup"
    else if (arg === "--set-password") {
      // Refuse without echoing it: a password typed here is already in shell history.
      if (argv[i + 1] !== undefined && !argv[i + 1]?.startsWith("--"))
        throw new Error("--set-password takes no value; it prompts on the terminal")
      action = "set-password"
    } else if (arg === "--clear-password") action = "clear-password"
    else if (arg === "--unlock") action = "unlock"
    else throw new Error(`unknown argument ${arg}\n${BRIDGE_USAGE}`)
  }
  // The saved tunnel hostname is a Cloudflare setting; Tailscale never inherits it.
  if (preset === "cf") publicHost ??= config.publicHost ?? null
  if (publicHost !== null && !/^[A-Za-z0-9.-]+$/.test(publicHost)) {
    throw new Error(`--public-host must be a bare hostname (no scheme, port or path), got ${publicHost}`)
  }
  if (preset !== "none" && hosts.length > 0)
    throw new Error("--host cannot be combined with --preset; the preset picks the address")
  const base = { port, rotateToken, rotateRelay, relayShellDir, qr, device, action, relayServer: null }

  if (preset === "tailscale") {
    const ts = deps.tailscale?.() ?? { ipv4: null, dnsName: null }
    // Never fall back to a wider bind: a missing tailnet must not become 0.0.0.0.
    if (!ts.ipv4)
      throw new Error("--preset tailscale: `tailscale ip -4` returned no address — is Tailscale installed and up?")
    return {
      ...base,
      preset,
      hosts: [ts.ipv4],
      publicHost: publicHost ?? ts.dnsName,
      tls: publicHost !== null,
      cloudflare: null,
    }
  }

  if (preset === "cf") {
    if (!cfTeam || !cfAud)
      throw new Error("--preset cf needs --cf-team and --cf-aud (or cfTeam/cfAud in bridge/config.json)")
    if (!publicHost) throw new Error("--preset cf needs --public-host: the tunnel hostname the phone dials")
    return {
      ...base,
      preset,
      hosts: ["127.0.0.1"],
      publicHost,
      tls: true,
      cloudflare: { teamDomain: teamDomainOf(cfTeam), aud: cfAud.trim() },
    }
  }

  if (preset === "relay") {
    if (!relayServer)
      throw new Error("--preset relay needs --relay-server <url> (or relayServer in bridge/config.json)")
    if (publicHost !== null) throw new Error("--public-host cannot be combined with --preset relay")
    return {
      ...base,
      preset,
      hosts: ["127.0.0.1"],
      publicHost: null,
      tls: false,
      cloudflare: null,
      relayServer: relayOriginOf(relayServer),
    }
  }

  return {
    ...base,
    preset,
    hosts: hosts.length > 0 ? [...new Set(hosts)] : ["127.0.0.1"],
    // A plain tunnel to 127.0.0.1 (cloudflared without Access) terminates TLS at <publicHost>.
    publicHost,
    tls: publicHost !== null,
    cloudflare: null,
  }
}

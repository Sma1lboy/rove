/**
 * Bridge argv → where to listen and how the phone reaches it. Pure: the
 * Tailscale address lookup and the saved config are injected, so every rule
 * here is testable without a tailnet.
 */

export type Preset = "none" | "tailscale" | "cf"

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
  readonly rotateToken: boolean
  readonly qr: boolean
}

/** `<ROVE_HOME>/.rove/bridge/config.json`; flags override it. `publicHost` applies to `--preset cf` only. */
export interface BridgeConfig {
  readonly cfTeam?: string
  readonly cfAud?: string
  readonly publicHost?: string
}

export interface TailscaleInfo {
  readonly ipv4: string | null
  readonly dnsName: string | null
}

export const DEFAULT_BRIDGE_PORT = 7878

export const BRIDGE_USAGE = `usage: rove-bridge [--preset tailscale|cf] [--host <addr>]... [--port <n>]
                  [--public-host <name>] [--cf-team <team>] [--cf-aud <aud>]
                  [--rotate-token] [--no-qr]

  (no preset)          listen on 127.0.0.1 only (or each --host you name)
  --preset tailscale   listen on this Mac's Tailscale IPv4 only; fails if Tailscale
                       is not up. With --public-host <name> (a \`tailscale serve\`
                       HTTPS name) the phone dials wss://<name>.
  --preset cf          listen on 127.0.0.1 for cloudflared; every connection must
                       carry a valid Cloudflare Access JWT. Needs --public-host
                       (the tunnel hostname), --cf-team and --cf-aud.
  --port <n>           TCP port (default ${DEFAULT_BRIDGE_PORT})
  --rotate-token       mint a new pairing token, revoking every paired phone
  --no-qr              print the pairing URL without a QR code

  --cf-team, --cf-aud and --public-host may also live in
  <ROVE_HOME>/.rove/bridge/config.json as cfTeam, cfAud, publicHost.`

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
  let rotateToken = false
  let qr = true
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
      else throw new Error(`--preset must be tailscale or cf, got ${p}`)
    } else if (arg === "--port") {
      const raw = value()
      port = Number(raw)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port must be 1..65535, got ${raw}`)
    } else if (arg === "--public-host") publicHost = value()
    else if (arg === "--cf-team") cfTeam = value()
    else if (arg === "--cf-aud") cfAud = value()
    else if (arg === "--rotate-token") rotateToken = true
    else if (arg === "--no-qr") qr = false
    else throw new Error(`unknown argument ${arg}\n${BRIDGE_USAGE}`)
  }
  // The saved tunnel hostname is a Cloudflare setting; Tailscale never inherits it.
  if (preset === "cf") publicHost ??= config.publicHost ?? null
  if (publicHost !== null && !/^[A-Za-z0-9.-]+$/.test(publicHost)) {
    throw new Error(`--public-host must be a bare hostname (no scheme, port or path), got ${publicHost}`)
  }
  if (preset !== "none" && hosts.length > 0)
    throw new Error("--host cannot be combined with --preset; the preset picks the address")
  const base = { port, rotateToken, qr }

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

  return {
    ...base,
    preset,
    hosts: hosts.length > 0 ? [...new Set(hosts)] : ["127.0.0.1"],
    publicHost: null,
    tls: false,
    cloudflare: null,
  }
}

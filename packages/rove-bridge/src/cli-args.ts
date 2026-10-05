export interface BridgeArgs {
  /** Interfaces to listen on; loopback unless the user names more. */
  readonly hosts: readonly string[]
  readonly port: number
  readonly rotateToken: boolean
  readonly qr: boolean
}

export const DEFAULT_BRIDGE_PORT = 7878

export const BRIDGE_USAGE = `usage: rove-bridge [--host <addr>]... [--port <n>] [--rotate-token] [--no-qr]

  --host <addr>    interface to listen on (repeatable; default 127.0.0.1).
                   Use a Tailscale (100.x) or LAN address, or 0.0.0.0 for all.
  --port <n>       TCP port (default ${DEFAULT_BRIDGE_PORT})
  --rotate-token   mint a new pairing token, revoking every paired phone
  --no-qr          print the pairing URL without a QR code`

export function parseBridgeArgs(argv: readonly string[]): BridgeArgs {
  const hosts: string[] = []
  let port = DEFAULT_BRIDGE_PORT
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
    else if (arg === "--port") {
      const raw = value()
      port = Number(raw)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port must be 1..65535, got ${raw}`)
    } else if (arg === "--rotate-token") rotateToken = true
    else if (arg === "--no-qr") qr = false
    else throw new Error(`unknown argument ${arg}\n${BRIDGE_USAGE}`)
  }
  return { hosts: hosts.length > 0 ? [...new Set(hosts)] : ["127.0.0.1"], port, rotateToken, qr }
}

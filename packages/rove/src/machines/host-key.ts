/**
 * Confirm a machine's host key before the first connect, instead of letting
 * `StrictHostKeyChecking=accept-new` take it silently. Same trust-on-first-use,
 * but the user sees the fingerprint they are trusting.
 *
 * Resolution goes through `ssh -G`, so an ssh_config `Host` alias, `HostName`,
 * `Port` and `HostKeyAlias` name the same known_hosts entry ssh will look up.
 * A destination reached through a proxy is not scanned: `ssh-keyscan` ignores
 * `ProxyJump`/`ProxyCommand` and would fingerprint the wrong host.
 */

import { spawn } from "node:child_process"
import { appendFileSync, chmodSync, existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname } from "node:path"
import { type MachineConfig, sshTargetOf } from "./registry.ts"

export interface SshDestination {
  /** The known_hosts lookup name: `host`, `[host]:port`, or the HostKeyAlias. */
  readonly knownHostsName: string
  readonly hostname: string
  readonly port: number
  readonly userKnownHosts: readonly string[]
  readonly globalKnownHosts: readonly string[]
  readonly proxied: boolean
}

/** `ssh -G` output (`key value…` per line) → where ssh will connect and look keys up. */
export function parseSshG(stdout: string, home = homedir()): SshDestination {
  const values = new Map<string, string>()
  for (const line of stdout.split("\n")) {
    const space = line.indexOf(" ")
    if (space > 0) values.set(line.slice(0, space).toLowerCase(), line.slice(space + 1).trim())
  }
  const hostname = values.get("hostname") ?? ""
  const port = Number(values.get("port") ?? "22") || 22
  const files = (key: string): string[] =>
    (values.get(key) ?? "")
      .split(/\s+/)
      .filter((f) => f && f !== "none")
      .map((f) => (f.startsWith("~/") ? `${home}${f.slice(1)}` : f))
  const alias = values.get("hostkeyalias")
  const proxy = (key: string): boolean => {
    const v = values.get(key)
    return v !== undefined && v !== "none"
  }
  return {
    knownHostsName: alias && alias !== "none" ? alias : port === 22 ? hostname : `[${hostname}]:${port}`,
    hostname,
    port,
    userKnownHosts: files("userknownhostsfile"),
    globalKnownHosts: files("globalknownhostsfile"),
    proxied: proxy("proxyjump") || proxy("proxycommand"),
  }
}

export type HostKeyCheck =
  | { readonly state: "known" }
  /** Not checked: a proxied destination, or ssh tools missing. ssh's own TOFU applies. */
  | { readonly state: "skipped"; readonly reason: string }
  | {
      readonly state: "unknown"
      readonly destination: SshDestination
      /** `ssh-keygen -l` lines, one per key type the host offered. */
      readonly fingerprints: readonly string[]
      /** Append the scanned keys to the user's known_hosts. */
      trust(): void
    }

export async function checkHostKey(config: MachineConfig): Promise<HostKeyCheck> {
  const target = sshTargetOf(config)
  const resolved = await run(["ssh", "-G", ...(config.port ? ["-p", String(config.port)] : []), target])
  if (resolved.code !== 0) return { state: "skipped", reason: "ssh -G failed" }
  const destination = parseSshG(resolved.stdout)
  if (!destination.hostname) return { state: "skipped", reason: "ssh -G named no host" }
  if (destination.proxied) return { state: "skipped", reason: "reached through a proxy" }
  for (const file of [...destination.userKnownHosts, ...destination.globalKnownHosts]) {
    if (!existsSync(file)) continue
    if ((await run(["ssh-keygen", "-F", destination.knownHostsName, "-f", file])).code === 0) return { state: "known" }
  }
  const scan = await run(["ssh-keyscan", "-T", "5", "-p", String(destination.port), destination.hostname])
  const keys = scan.stdout.split("\n").filter((line) => line.trim() && !line.startsWith("#"))
  // An unreachable host scans empty; the connect that follows reports why.
  if (keys.length === 0) return { state: "skipped", reason: "the host offered no key" }
  const named = keys.map((line) => line.replace(/^\S+/, destination.knownHostsName))
  const printed = await run(["ssh-keygen", "-l", "-f", "-"], `${named.join("\n")}\n`)
  const fingerprints = printed.stdout.split("\n").filter((line) => line.trim())
  return {
    state: "unknown",
    destination,
    fingerprints,
    trust() {
      const file = destination.userKnownHosts[0] ?? `${homedir()}/.ssh/known_hosts`
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      appendFileSync(file, `${named.join("\n")}\n`, { mode: 0o600 })
      try {
        chmodSync(file, 0o600)
      } catch {
        /* not ours to tighten */
      }
    },
  }
}

function run(argv: readonly string[], stdin?: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = ""
    const child = spawn(argv[0] ?? "ssh", argv.slice(1), {
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "ignore"],
    })
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000)
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve({ code: -1, stdout })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout })
    })
    if (stdin !== undefined) child.stdin?.end(stdin)
  })
}

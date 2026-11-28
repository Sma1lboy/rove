/**
 * `rove gateway <verb>` — configure and inspect the opt-in local loopback
 * provider gateway (`rove-daemon`).
 *
 * Security: API keys are never accepted on argv flags and never written to
 * plain files; `set-key` reads from hidden TTY prompt or stdin and stores in
 * macOS Keychain via `security`, with an explicit env-var fallback on other OSes.
 */

import { createInterface } from "node:readline"
import { SUBCOMMAND_VERBS } from "@sma1lboy/rove-api/cli/subcommands.ts"
import { argvHasFlag, switchFlag } from "@sma1lboy/rove-core/lib/argv.ts"
import { ROVE_PRODUCT_NAME } from "@sma1lboy/rove-core/product.ts"
import {
  loadProviderGatewayConfig,
  removeGatewayProvider,
  setProviderGatewayEnabled,
  upsertGatewayProvider,
} from "@sma1lboy/rove-core/state/provider-gateway.ts"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { defaultDaemonSocketPath } from "@sma1lboy/rove-daemon/daemon/paths"
import { validateBindHost, validateProviderId, validateProviderInput } from "@sma1lboy/rove-daemon/gateway/config"
import {
  type GatewayCredentialDeps,
  deleteGatewayProviderKey,
  describeProviderKeySource,
  effectiveProviderKeyEnv,
  isGatewayKeychainSupported,
  setGatewayProviderKey,
  unsupportedKeychainMessage,
} from "@sma1lboy/rove-daemon/gateway/keychain"
import type { GatewayInjectMode, ProviderGatewayStatus } from "@sma1lboy/rove-daemon/gateway/types"

const CLI_NAME = ROVE_PRODUCT_NAME

export interface GatewayCliDeps {
  readonly stdout?: Pick<typeof process.stdout, "write">
  readonly stderr?: Pick<typeof process.stderr, "write">
  readonly exit?: (code: number) => never
  readonly credentialDeps?: GatewayCredentialDeps
  readonly readSecret?: (prompt: string, fromStdin: boolean) => Promise<string>
  readonly daemonRequest?: <T = unknown>(name: string, payload?: unknown) => Promise<T>
}

function usage(): string {
  return [
    `Usage: ${CLI_NAME} gateway <${SUBCOMMAND_VERBS.gateway.join("|")}> [options]`,
    "",
    "Manage the optional local 127.0.0.1 provider gateway (disabled by default).",
    "",
    "Commands:",
    "  status [--json]                  Show gateway runtime status and provider health",
    "  enable [--port N] [--host IP] [--inject headless|off]",
    "                                   Enable the local loopback gateway and reload daemon",
    "  disable                          Disable the gateway and reload daemon",
    "  list                             List configured providers (sorted by priority)",
    "  add <id> --protocol anthropic|openai --base-url <url> --models <csv>",
    "      [--priority N] [--api-key-env VAR] [--model-map from=to,...]",
    "                                   Add or update a provider entry (no secrets in config)",
    "  remove <id> [--purge-key]        Remove a provider (optionally delete Keychain key)",
    "  set-key <id> [--stdin]           Store an upstream API key in OS Keychain (macOS)",
    "  delete-key <id>                  Delete a stored API key from OS Keychain (macOS)",
    "  reset-cooldown [id]              Clear provider cooldown on the running daemon",
    "",
  ].join("\n")
}

async function defaultReadSecret(promptText: string, fromStdin: boolean): Promise<string> {
  if (fromStdin || !process.stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk)
    }
    return Buffer.concat(chunks).toString("utf8").trim()
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const out = process.stdout as NodeJS.WriteStream & { _writeToOutput?: (s: string) => void }
  let muted = false
  const original = out._writeToOutput?.bind(out)
  out._writeToOutput = (s: string) => {
    if (!muted || !original) process.stdout.write(s)
  }
  process.stdout.write(promptText)
  muted = true
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      muted = false
      if (original) out._writeToOutput = original
      process.stdout.write("\n")
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function defaultDaemonRequest<T = unknown>(name: string, payload?: unknown): Promise<T> {
  const client = new RoveDaemonClient(defaultDaemonSocketPath())
  try {
    return await client.request<T>(name as never, payload)
  } finally {
    client.close()
  }
}

async function reloadDaemonBestEffort(
  request: <T = unknown>(name: string, payload?: unknown) => Promise<T>,
): Promise<ProviderGatewayStatus | null> {
  try {
    return await request<ProviderGatewayStatus>("gateway.reload", {})
  } catch {
    return null
  }
}

function parseModelMap(raw: string): Record<string, string> | null {
  const map: Record<string, string> = {}
  for (const part of raw.split(",")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0 || eq === trimmed.length - 1) return null
    map[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return map
}

function formatStatusText(status: ProviderGatewayStatus, daemonReachable: boolean): string {
  const lines: string[] = [
    `Provider gateway: ${status.enabled ? "enabled" : "disabled"} (${status.running ? `listening on ${status.baseUrl}` : daemonReachable ? "stopped" : "daemon not running"})`,
    `  injectMode: ${status.injectMode} | keychain: ${status.keychainSupported ? "macOS security CLI" : "env-only fallback"}`,
  ]
  if (status.providers.length === 0) {
    lines.push("  providers: (none configured)")
  } else {
    lines.push("  providers:")
    for (const p of status.providers) {
      const state = !p.enabled ? "disabled" : p.inCooldown ? `cooldown until ${p.cooldownUntil}` : "ready"
      const keyLabel = p.keySource === "none" ? `none (set Keychain or ${p.apiKeyEnv})` : p.keySource
      lines.push(
        `    - ${p.id} [priority=${p.priority}, ${p.protocol}, ${state}] ${p.baseUrl} | models=${p.models.join(",")} | key=${keyLabel} | req=${p.requests} failovers=${p.failovers}`,
      )
    }
  }
  return `${lines.join("\n")}\n`
}

export async function runGatewaySubcommand(argv: readonly string[], deps: GatewayCliDeps = {}): Promise<void> {
  const out = deps.stdout ?? process.stdout
  const err = deps.stderr ?? process.stderr
  const exit = deps.exit ?? ((code: number) => process.exit(code))
  const credDeps = deps.credentialDeps
  const readSecret = deps.readSecret ?? defaultReadSecret
  const daemonRequest = deps.daemonRequest ?? defaultDaemonRequest

  const fail = (message: string, code = 2): never => {
    err.write(`${CLI_NAME} gateway: ${message}\n`)
    if (code === 2) err.write(`\n${usage()}`)
    return exit(code)
  }

  const [verb = "status", ...rest] = argv
  if (verb === "-h" || verb === "--help" || verb === "help") {
    out.write(usage())
    return
  }
  if (!SUBCOMMAND_VERBS.gateway.includes(verb)) {
    return fail(`unknown command "${verb}"`)
  }

  if (verb === "status") {
    const asJson = switchFlag(rest, "--json")
    if (asJson === undefined) return fail("--json takes true or false")
    const bad = rest.find((a) => !argvHasFlag([a], "--json"))
    if (bad) return fail(`unknown flag "${bad}"`)

    let live: ProviderGatewayStatus | null = null
    try {
      live = await daemonRequest<ProviderGatewayStatus>("gateway.status", {})
    } catch {
      live = null
    }
    if (live) {
      if (asJson) out.write(`${JSON.stringify(live, null, 2)}\n`)
      else out.write(formatStatusText(live, true))
      return
    }
    const cfg = loadProviderGatewayConfig()
    const offline: ProviderGatewayStatus = {
      enabled: cfg.enabled,
      running: false,
      host: cfg.host,
      port: null,
      baseUrl: null,
      injectMode: cfg.injectMode,
      keychainSupported: isGatewayKeychainSupported(credDeps),
      providers: [...cfg.providers]
        .sort((a, b) => a.priority - b.priority)
        .map((p) => ({
          id: p.id,
          protocol: p.protocol,
          baseUrl: p.baseUrl,
          priority: p.priority,
          models: p.models,
          enabled: p.enabled,
          keySource: describeProviderKeySource(p, credDeps),
          apiKeyEnv: effectiveProviderKeyEnv(p),
          inCooldown: false,
          cooldownUntil: null,
          consecutiveFailures: 0,
          lastStatus: null,
          lastError: null,
          lastSuccessAt: null,
          requests: 0,
          failovers: 0,
        })),
    }
    if (asJson) out.write(`${JSON.stringify(offline, null, 2)}\n`)
    else out.write(formatStatusText(offline, false))
    return
  }

  if (verb === "enable") {
    let port: number | undefined
    let host: "127.0.0.1" | "::1" | undefined
    let injectMode: GatewayInjectMode | undefined
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]
      if (arg === "--port") {
        const raw = rest[++i]
        const parsed = Number(raw)
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) return fail(`invalid --port "${raw ?? ""}"`)
        port = parsed
      } else if (arg === "--host") {
        const raw = rest[++i]
        const valid = validateBindHost(raw)
        if (!valid) return fail(`--host must be a literal loopback IP ("127.0.0.1" or "::1"), got "${raw ?? ""}"`)
        host = valid
      } else if (arg === "--inject") {
        const raw = rest[++i]
        if (raw !== "headless" && raw !== "off") return fail(`--inject must be "headless" or "off", got "${raw ?? ""}"`)
        injectMode = raw
      } else {
        return fail(`unknown flag "${arg}"`)
      }
    }
    const saved = setProviderGatewayEnabled(true, { host, port, injectMode })
    const live = await reloadDaemonBestEffort(daemonRequest)
    if (live?.running && live.baseUrl) {
      out.write(`provider gateway enabled and listening on ${live.baseUrl} (injectMode=${saved.injectMode})\n`)
    } else {
      out.write(
        `provider gateway enabled in config (host=${saved.host}, port=${saved.port}, injectMode=${saved.injectMode}); start or restart the daemon to bind\n`,
      )
    }
    return
  }

  if (verb === "disable") {
    if (rest.length > 0) return fail(`unexpected argument "${rest[0]}"`)
    setProviderGatewayEnabled(false)
    await reloadDaemonBestEffort(daemonRequest)
    out.write("provider gateway disabled\n")
    return
  }

  if (verb === "list") {
    if (rest.length > 0) return fail(`unexpected argument "${rest[0]}"`)
    const cfg = loadProviderGatewayConfig()
    const sorted = [...cfg.providers].sort((a, b) => a.priority - b.priority)
    if (sorted.length === 0) {
      out.write("no gateway providers configured\n")
      return
    }
    for (const p of sorted) {
      const source = describeProviderKeySource(p, credDeps)
      out.write(
        `${p.id}\tpriority=${p.priority}\tprotocol=${p.protocol}\tkey=${source}\tmodels=${p.models.join(",")}\t${p.baseUrl}\n`,
      )
    }
    return
  }

  if (verb === "add") {
    const id = rest[0]
    if (!id || id.startsWith("-")) return fail("provider id is required")
    let protocol = ""
    let baseUrl = ""
    let models: string[] = []
    let priority: number | undefined
    let apiKeyEnv: string | undefined
    let modelMap: Record<string, string> | undefined
    for (let i = 1; i < rest.length; i++) {
      const flag = rest[i]
      if (flag === "--protocol") protocol = rest[++i] ?? ""
      else if (flag === "--base-url") baseUrl = rest[++i] ?? ""
      else if (flag === "--models")
        models = (rest[++i] ?? "")
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean)
      else if (flag === "--priority") {
        const raw = rest[++i]
        const n = Number(raw)
        if (!Number.isInteger(n)) return fail(`invalid --priority "${raw ?? ""}"`)
        priority = n
      } else if (flag === "--api-key-env") apiKeyEnv = rest[++i] ?? ""
      else if (flag === "--model-map") {
        const parsed = parseModelMap(rest[++i] ?? "")
        if (!parsed) return fail("--model-map must be comma-separated from=to pairs")
        modelMap = parsed
      } else if (flag === "--api-key" || flag === "--key") {
        return fail("never pass API keys on the command line — use `rove gateway set-key <id>` or `--api-key-env VAR`")
      } else {
        return fail(`unknown flag "${flag}"`)
      }
    }
    const validated = validateProviderInput({ id, protocol, baseUrl, models, priority, apiKeyEnv, modelMap })
    if (!validated.ok) return fail(validated.error)
    upsertGatewayProvider(validated.provider)
    await reloadDaemonBestEffort(daemonRequest)
    out.write(
      `saved provider "${validated.provider.id}" (${validated.provider.protocol}, priority=${validated.provider.priority}, models=${validated.provider.models.join(",")})\n`,
    )
    return
  }

  if (verb === "remove") {
    const id = rest[0]
    if (!id || id.startsWith("-")) return fail("provider id is required")
    const flags = rest.slice(1)
    const purgeKey = switchFlag(flags, "--purge-key")
    if (purgeKey === undefined) return fail("--purge-key takes true or false")
    const bad = flags.find((a) => !argvHasFlag([a], "--purge-key"))
    if (bad) return fail(`unknown flag "${bad}"`)
    const existing = loadProviderGatewayConfig().providers.find((p) => p.id === id)
    const { removed } = removeGatewayProvider(id)
    if (!removed) return fail(`provider "${id}" not found`, 1)
    if (purgeKey) {
      deleteGatewayProviderKey(id, { account: existing?.keychainAccount, deps: credDeps })
    }
    await reloadDaemonBestEffort(daemonRequest)
    out.write(`removed provider "${id}"${purgeKey ? " (purged keychain entry)" : ""}\n`)
    return
  }

  if (verb === "set-key") {
    const id = rest[0]
    if (!id || id.startsWith("-")) return fail("provider id is required")
    if (!validateProviderId(id)) return fail(`invalid provider id "${id}"`)
    const flags = rest.slice(1)
    const fromStdin = switchFlag(flags, "--stdin")
    if (fromStdin === undefined) return fail("--stdin takes true or false")
    const bad = flags.find((a) => !argvHasFlag([a], "--stdin"))
    if (bad) return fail(`unknown flag "${bad}" (keys are read from stdin or a hidden prompt, never argv)`)
    const existing = loadProviderGatewayConfig().providers.find((p) => p.id === id)
    if (!isGatewayKeychainSupported(credDeps)) {
      return fail(unsupportedKeychainMessage(id, existing?.apiKeyEnv), 1)
    }
    const secret = await readSecret(`API key for provider "${id}": `, fromStdin)
    if (!secret) return fail("empty API key; nothing stored", 1)
    const ok = setGatewayProviderKey(id, secret, { account: existing?.keychainAccount, deps: credDeps })
    if (!ok) return fail(`failed to store API key for "${id}" in macOS Keychain`, 1)
    out.write(`stored API key for "${id}" in macOS Keychain (never written to plain files)\n`)
    return
  }

  if (verb === "delete-key") {
    const id = rest[0]
    if (!id || id.startsWith("-") || rest.length > 1) return fail("provider id is required")
    if (!validateProviderId(id)) return fail(`invalid provider id "${id}"`)
    const existing = loadProviderGatewayConfig().providers.find((p) => p.id === id)
    if (!isGatewayKeychainSupported(credDeps)) {
      return fail(unsupportedKeychainMessage(id, existing?.apiKeyEnv), 1)
    }
    const deleted = deleteGatewayProviderKey(id, { account: existing?.keychainAccount, deps: credDeps })
    out.write(deleted ? `deleted Keychain API key for "${id}"\n` : `no Keychain API key found for "${id}"\n`)
    return
  }

  if (verb === "reset-cooldown") {
    if (rest.length > 1) return fail(`unexpected argument "${rest[1]}"`)
    const providerId = rest[0]
    try {
      const res = await daemonRequest<{ reset: number }>("gateway.resetCooldown", providerId ? { providerId } : {})
      out.write(`cleared cooldown for ${res.reset} provider(s)\n`)
    } catch (e) {
      return fail(`daemon unavailable: ${e instanceof Error ? e.message : String(e)}`, 1)
    }
  }
}

/**
 * Credential store for the local provider gateway.
 *
 * macOS: stores and reads upstream API keys in the macOS Keychain via the
 * `security` CLI (never written to plain files).
 * Other OSes (Linux/Windows): reports keychain unsupported and resolves keys
 * strictly from the daemon's environment (`provider.apiKeyEnv` or the
 * `ROVE_GATEWAY_KEY_<ID>` convention), never writing secrets to plain files.
 */

import { spawnSync } from "node:child_process"
import { platform } from "node:os"
import type { GatewayKeySource, GatewayProviderConfig } from "./types.ts"

export const GATEWAY_KEYCHAIN_SERVICE = "rove-provider-gateway"

export interface GatewayKeychainRef {
  readonly service: string
  readonly account: string
}

/** Injectable so unit tests never touch the host's real Keychain or process.env. */
export interface GatewayCredentialDeps {
  run(argv: readonly string[]): { stdout: string; exitCode: number }
  platform(): string
  env(): NodeJS.ProcessEnv
}

const defaultDeps: GatewayCredentialDeps = {
  run(argv) {
    const [cmd, ...rest] = argv
    const proc = spawnSync(cmd ?? "", rest, { encoding: "utf8", shell: false })
    return { stdout: proc.stdout ?? "", exitCode: proc.status ?? -1 }
  },
  platform: () => platform(),
  env: () => process.env,
}

/** Default Keychain reference for a gateway provider id. */
export function gatewayKeychainRef(providerId: string, accountOverride?: string): GatewayKeychainRef {
  return {
    service: GATEWAY_KEYCHAIN_SERVICE,
    account: accountOverride?.trim() || `provider:${providerId}`,
  }
}

/** Default fallback env var name for a provider (e.g. `openrouter` -> `ROVE_GATEWAY_KEY_OPENROUTER`). */
export function defaultProviderKeyEnv(providerId: string): string {
  const normalized = providerId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return `ROVE_GATEWAY_KEY_${normalized || "PROVIDER"}`
}

export function effectiveProviderKeyEnv(provider: Pick<GatewayProviderConfig, "id" | "apiKeyEnv">): string {
  return provider.apiKeyEnv?.trim() || defaultProviderKeyEnv(provider.id)
}

export function isGatewayKeychainSupported(deps: GatewayCredentialDeps = defaultDeps): boolean {
  return deps.platform() === "darwin"
}

export function unsupportedKeychainMessage(providerId: string, envVar?: string): string {
  const name = envVar?.trim() || defaultProviderKeyEnv(providerId)
  return `OS Keychain storage is only wired for macOS (via the \`security\` CLI). On this OS, export ${name} in the daemon environment instead — Rove will never write API keys to plain files.`
}

/** Store or update a provider's API key in macOS Keychain. Returns false on non-macOS or failure. */
export function setGatewayProviderKey(
  providerId: string,
  secret: string,
  opts?: { readonly account?: string; readonly deps?: GatewayCredentialDeps },
): boolean {
  const deps = opts?.deps ?? defaultDeps
  if (!isGatewayKeychainSupported(deps)) return false
  const trimmed = secret.trim()
  if (!trimmed) return false
  const ref = gatewayKeychainRef(providerId, opts?.account)
  const { exitCode } = deps.run([
    "security",
    "add-generic-password",
    "-U",
    "-s",
    ref.service,
    "-a",
    ref.account,
    "-w",
    trimmed,
  ])
  return exitCode === 0
}

/** Read a provider's API key directly from macOS Keychain; null if absent or unsupported. */
export function getGatewayKeychainKey(
  providerId: string,
  opts?: { readonly account?: string; readonly deps?: GatewayCredentialDeps },
): string | null {
  const deps = opts?.deps ?? defaultDeps
  if (!isGatewayKeychainSupported(deps)) return null
  const ref = gatewayKeychainRef(providerId, opts?.account)
  const { stdout, exitCode } = deps.run([
    "security",
    "find-generic-password",
    "-s",
    ref.service,
    "-a",
    ref.account,
    "-w",
  ])
  if (exitCode !== 0) return null
  const value = stdout.replace(/\r?\n$/, "")
  return value.length > 0 ? value : null
}

/** Delete a provider's API key from macOS Keychain. */
export function deleteGatewayProviderKey(
  providerId: string,
  opts?: { readonly account?: string; readonly deps?: GatewayCredentialDeps },
): boolean {
  const deps = opts?.deps ?? defaultDeps
  if (!isGatewayKeychainSupported(deps)) return false
  const ref = gatewayKeychainRef(providerId, opts?.account)
  const { exitCode } = deps.run(["security", "delete-generic-password", "-s", ref.service, "-a", ref.account])
  return exitCode === 0
}

/**
 * Resolve the upstream API key just-in-time for a request.
 * Resolution order:
 *   1. macOS Keychain (when supported and present).
 *   2. Configured `apiKeyEnv` (or `ROVE_GATEWAY_KEY_<ID>`) in the daemon's env.
 */
export function resolveProviderApiKey(
  provider: Pick<GatewayProviderConfig, "id" | "keychainAccount" | "apiKeyEnv">,
  deps: GatewayCredentialDeps = defaultDeps,
): { readonly key: string; readonly source: Exclude<GatewayKeySource, "none"> } | null {
  const keychainKey = getGatewayKeychainKey(provider.id, { account: provider.keychainAccount, deps })
  if (keychainKey) return { key: keychainKey, source: "keychain" }
  const envName = effectiveProviderKeyEnv(provider)
  const envValue = deps.env()[envName]?.trim()
  if (envValue) return { key: envValue, source: "env" }
  return null
}

/** Safe status summary — reports WHERE the key comes from, never the key itself. */
export function describeProviderKeySource(
  provider: Pick<GatewayProviderConfig, "id" | "keychainAccount" | "apiKeyEnv">,
  deps: GatewayCredentialDeps = defaultDeps,
): GatewayKeySource {
  const resolved = resolveProviderApiKey(provider, deps)
  return resolved ? resolved.source : "none"
}

/**
 * Where each vendor's CLI keeps its own state, and the files inside it that
 * Rove reads.
 *
 * The env-var names below are the contract each vendor CLI honors, so a
 * drift between two copies of this derivation is a correctness bug that only
 * shows up under an isolated profile (a `CLAUDE_CONFIG_DIR` sandbox, the
 * dev-sandbox `HOME`) — which is exactly where it is hardest to notice. It
 * was written out nine times across six files before this module existed.
 *
 * Read per call, never cached: a module-level `const` would freeze whichever
 * profile happened to be set at import time and silently write to the real
 * `~/.claude`.
 */

import { homedir } from "node:os"
import path from "node:path"

/** The vendors whose CLI keeps a relocatable config home. */
export type ConfigHomeVendor = "claude" | "codex" | "copilot" | "kimi"

/** Env override + default directory name, per vendor. */
const VENDOR_HOMES: Readonly<Record<ConfigHomeVendor, { readonly envVar: string; readonly dirName: string }>> = {
  claude: { envVar: "CLAUDE_CONFIG_DIR", dirName: ".claude" },
  codex: { envVar: "CODEX_HOME", dirName: ".codex" },
  copilot: { envVar: "COPILOT_HOME", dirName: ".copilot" },
  kimi: { envVar: "KIMI_CODE_HOME", dirName: ".kimi-code" },
}

/** Env/home injection. Defaults read the live process, which is what every
 *  non-test caller wants. */
export interface VendorHomeDeps {
  env(name: string): string | undefined
  home(): string
}

const defaultVendorHomeDeps: VendorHomeDeps = {
  env: (name) => process.env[name],
  home: () => homedir(),
}

/** An explicitly supplied home isolates write fixtures from ambient profiles. */
export function vendorWriteHomeDeps(home?: string): VendorHomeDeps {
  return home === undefined ? defaultVendorHomeDeps : { env: () => undefined, home: () => home }
}

/**
 * The vendor's config directory. An override that is empty or whitespace
 * counts as unset — `.trim()` was already reaching for that, and treating
 * `CODEX_HOME=""` as a real path would send reads to the filesystem root.
 */
export function vendorConfigHome(vendor: ConfigHomeVendor, deps: VendorHomeDeps = defaultVendorHomeDeps): string {
  const { envVar, dirName } = VENDOR_HOMES[vendor]
  const override = deps.env(envVar)?.trim()
  if (override) return override
  return path.join(deps.home(), dirName)
}

/** Adapter for the `(env, home)` parameter shape account-detect's callers use. */
function depsOf(env: (k: string) => string | undefined, home: string): VendorHomeDeps {
  return { env, home: () => home }
}

/**
 * claude-code's global config. Note the asymmetry, which is the CLI's own:
 * with `CLAUDE_CONFIG_DIR` set the file sits INSIDE that dir, but with it
 * unset the file is `~/.claude.json` at the home root — NOT inside `~/.claude`.
 */
export function claudeGlobalConfigPath(env: (k: string) => string | undefined, home: string): string {
  const override = env("CLAUDE_CONFIG_DIR")?.trim()
  if (override) return path.join(override, ".claude.json")
  return path.join(home, ".claude.json")
}

/** codex's auth file (`~/.codex/auth.json` by default). */
export function codexAuthPath(env: (k: string) => string | undefined, home: string): string {
  return path.join(vendorConfigHome("codex", depsOf(env, home)), "auth.json")
}

/** copilot's config file (`~/.copilot/config.json` by default). */
export function copilotConfigPath(env: (k: string) => string | undefined, home: string): string {
  return path.join(vendorConfigHome("copilot", depsOf(env, home)), "config.json")
}

/** kimi's OAuth credential file (`~/.kimi-code/credentials/kimi-code.json`). */
export function kimiCredentialsPath(env: (k: string) => string | undefined, home: string): string {
  return path.join(vendorConfigHome("kimi", depsOf(env, home)), "credentials", "kimi-code.json")
}

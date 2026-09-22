/**
 * Where each vendor's CLI keeps its own state, and the files inside it that
 * Rove reads.
 *
 * The env-var names are each CLI's contract; a second copy of this
 * derivation drifts silently and only bites under an isolated profile.
 *
 * Read per call, never cached: a module-level `const` would freeze the
 * import-time profile and silently write to the real `~/.claude`.
 */

import { homedir } from "node:os"
import path from "node:path"

/** The vendors whose CLI keeps a relocatable config home. */
export type ConfigHomeVendor = "claude" | "codex" | "copilot" | "kimi"

/** The vendors whose CLI keeps a relocatable AGENT directory — the one that
 *  holds `sessions/`, `settings.json` and `extensions/`. Their env override
 *  names that directory directly, with no config home above it. */
export type AgentDirVendor = "pi" | "omp"

/** Env override + default directory name, per vendor. */
const VENDOR_HOMES: Readonly<Record<ConfigHomeVendor, { readonly envVar: string; readonly dirName: string }>> = {
  claude: { envVar: "CLAUDE_CONFIG_DIR", dirName: ".claude" },
  codex: { envVar: "CODEX_HOME", dirName: ".codex" },
  copilot: { envVar: "COPILOT_HOME", dirName: ".copilot" },
  kimi: { envVar: "KIMI_CODE_HOME", dirName: ".kimi-code" },
}

/**
 * The pi coding-agent family — `omp` forks `@earendil-works/pi-coding-agent`
 * and shares its layout and `PI_CODING_AGENT_DIR` override (verified: omp
 * 18.1.17 documents it in `--help`; pi 0.80.6 derives it from APP_NAME `pi`).
 * They differ only in the default directory, hence keyed by vendor. */
const AGENT_DIR_VENDORS: Readonly<Record<AgentDirVendor, { readonly envVar: string; readonly dirName: string }>> = {
  pi: { envVar: "PI_CODING_AGENT_DIR", dirName: ".pi" },
  omp: { envVar: "PI_CODING_AGENT_DIR", dirName: ".omp" },
}

/** Env/home injection; defaults read the live process. */
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

/** The vendor's config directory. An empty/whitespace override counts as unset — `CODEX_HOME=""` would otherwise read from the filesystem root. */
export function vendorConfigHome(vendor: ConfigHomeVendor, deps: VendorHomeDeps = defaultVendorHomeDeps): string {
  const { envVar, dirName } = VENDOR_HOMES[vendor]
  const override = deps.env(envVar)?.trim()
  if (override) return override
  return path.join(deps.home(), dirName)
}

/**
 * The pi/omp AGENT directory (`~/.pi/agent`, `~/.omp/agent` by default).
 *
 * NOT `vendorConfigHome`: this override names the agent dir itself, so the
 * config-home resolver would write Rove's hook to `<override>/agent/extensions`,
 * where the CLI never reads.
 */
export function vendorAgentDir(vendor: AgentDirVendor, deps: VendorHomeDeps = defaultVendorHomeDeps): string {
  const { envVar, dirName } = AGENT_DIR_VENDORS[vendor]
  const override = deps.env(envVar)?.trim()
  if (override) return override
  return path.join(deps.home(), dirName, "agent")
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

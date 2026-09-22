/**
 * Bun discovery + relaunch for the published `rove` / `kobe` bins.
 *
 * The bundle is a Bun program, but `npm install -g` / `npx` start the bin under
 * node. So the bin is a node launcher that finds Bun and re-execs the real
 * entry (offering to install Bun once if missing).
 *
 * Everything here must run under plain node: no Bun globals, no imports that
 * pull the Bun bundle in.
 *
 * Not an optionalDependency on `bun`: that downloads a ~90MB binary on every
 * install, even where Bun is present.
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process"
import { constants, accessSync } from "node:fs"
import { homedir } from "node:os"
import { basename, delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import pkg from "../../package.json" with { type: "json" }
import { activeCliName } from "./rename-compat.ts"

/** Point Rove at a specific Bun binary (skips every other candidate). */
export const BUN_OVERRIDE_ENV = "ROVE_BUN"
/** Set to `1` to make a missing Bun a hard error instead of an install offer. */
const NO_BOOTSTRAP_ENV = "ROVE_NO_BUN_BOOTSTRAP"
/** Set to `1` to run on a Bun below {@link MIN_BUN_VERSION} anyway (unsupported). */
export const SKIP_VERSION_CHECK_ENV = "ROVE_SKIP_BUN_CHECK"

/**
 * Oldest Bun this build runs on, from `package.json#engines.bun`.
 *
 * Load-bearing: an older Bun silently drops `Bun.spawn(…, { terminal })`
 * (src/tui/panes/terminal/pty.ts) — no PTY, no output. `bun install` ignores
 * `engines` and npm only honours it under `engine-strict`, so nothing else
 * enforces it.
 *
 * scripts/install.sh carries the same floor; test/architecture/bun-version-floor.test.ts
 * keeps them in sync.
 */
export const MIN_BUN_VERSION: string = pkg.engines.bun.match(/\d+\.\d+\.\d+/)?.[0] ?? "0.0.0"

/** A Bun that exists and runs, but predates {@link MIN_BUN_VERSION}. */
interface StaleBun {
  readonly path: string
  readonly version: string
}

/** What {@link resolveUsableBun} found: a Bun to run, plus the ones it walked past. */
export interface BunResolution {
  readonly bun: string | null
  /** First candidate that ran but is older than the floor. */
  readonly stale: StaleBun | null
  /** First candidate that is on disk and executable but could not be run at all. */
  readonly unusable: string | null
}

export interface BunLookup {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  home?: string
  /** Directory of the launcher, for finding a Bun installed beside the package. */
  launcherDir?: string
  isExecutable?: (path: string) => boolean
  /** Reads a candidate's `bun --version`; injected so tests never spawn. */
  bunVersionOf?: (path: string) => string | null
}

const defaultIsExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const bunFileName = (platform: NodeJS.Platform): string => (platform === "win32" ? "bun.exe" : "bun")

/**
 * First line of `bun --version`, or `null` when it can't RUN (exec error,
 * non-zero exit, 5s hang). Kept apart: an unrunnable binary would fail the
 * relaunch too, so skip it; unrecognised output is still a working Bun, and
 * refusing it would brick everyone the day Bun changes its version string.
 */
const defaultBunVersionOf = (path: string): string | null => {
  const result = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 5_000 })
  if (result.error || result.status !== 0) return null
  return result.stdout?.split("\n")[0]?.trim() ?? ""
}

/** `1.3.14`, `v1.3.14`, `1.3.14-canary.3` -> `1.3.14`; null when it isn't a version at all. */
export function parseBunVersion(raw: string): string | null {
  return raw.trim().match(/^v?(\d+\.\d+\.\d+)/)?.[1] ?? null
}

/**
 * Whether a reported Bun version clears the floor. Fails OPEN on anything
 * unparseable: it gates starting Rove at all. Not `version.ts`'s
 * `compareSemver` — that module reaches the Bun bundle.
 */
export function isBunAtLeast(raw: string, minimum: string = MIN_BUN_VERSION): boolean {
  const found = parseBunVersion(raw)
  const floor = parseBunVersion(minimum)
  if (!found || !floor) return true
  const a = found.split(".").map(Number)
  const b = floor.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av !== bv) return av > bv
  }
  return true
}

/** Whether the user has opted out of the version floor for this run. */
export function bunVersionCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SKIP_VERSION_CHECK_ENV] === "1"
}

/**
 * Every place a Bun runtime plausibly lives, in precedence order: explicit
 * override, PATH, Bun's own install prefix, the default `~/.bun`, then the
 * `bun` npm package if someone installed it next to Rove.
 */
export function bunCandidates(lookup: BunLookup = {}): string[] {
  const env = lookup.env ?? process.env
  const platform = lookup.platform ?? process.platform
  const home = lookup.home ?? env.HOME ?? env.USERPROFILE ?? homedir()
  const binary = bunFileName(platform)
  const candidates: string[] = []

  const override = env[BUN_OVERRIDE_ENV]?.trim()
  if (override) candidates.push(override)

  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    if (dir) candidates.push(join(dir, binary))
  }

  const bunInstall = env.BUN_INSTALL?.trim()
  if (bunInstall) candidates.push(join(bunInstall, "bin", binary))
  if (home) candidates.push(join(home, ".bun", "bin", binary))

  // `npm install bun` (or a `bun` dependency hoisted next to the package)
  // lands here; the binary is never on PATH, so probe it explicitly.
  const launcherDir = lookup.launcherDir
  if (launcherDir) {
    candidates.push(join(launcherDir, "..", "..", "node_modules", "bun", "bin", binary))
    candidates.push(join(launcherDir, "..", "..", "..", "bun", "bin", binary))
  }
  return candidates
}

/** First candidate that exists and is executable, or `null` when Bun is absent. */
export function resolveBunBinary(lookup: BunLookup = {}): string | null {
  const isExecutable = lookup.isExecutable ?? defaultIsExecutable
  return bunCandidates(lookup).find((candidate) => isExecutable(candidate)) ?? null
}

/**
 * First candidate that runs and clears {@link MIN_BUN_VERSION}, plus the ones
 * it walked past. Skips rather than stops: an old system Bun on PATH commonly
 * shadows a current `~/.bun`, and an unrunnable `bun` would wedge the relaunch.
 *
 * One `bun --version` per candidate until a hit (~4ms measured, vs ~300ms for
 * the node→Bun re-exec); node launcher path only.
 */
export function resolveUsableBun(lookup: BunLookup = {}): BunResolution {
  const isExecutable = lookup.isExecutable ?? defaultIsExecutable
  const versionOf = lookup.bunVersionOf ?? defaultBunVersionOf
  if (bunVersionCheckDisabled(lookup.env ?? process.env)) {
    return { bun: resolveBunBinary(lookup), stale: null, unusable: null }
  }
  let stale: StaleBun | null = null
  let unusable: string | null = null
  for (const candidate of bunCandidates(lookup)) {
    if (!isExecutable(candidate)) continue
    const raw = versionOf(candidate)
    if (raw === null) {
      unusable ??= candidate
      continue
    }
    if (isBunAtLeast(raw)) return { bun: candidate, stale, unusable }
    stale ??= { path: candidate, version: parseBunVersion(raw) ?? raw }
  }
  return { bun: null, stale, unusable }
}

/** Directory of the running launcher — the anchor for sibling-file lookups. */
export function launcherDirOf(moduleUrl: string): string {
  return dirname(fileURLToPath(moduleUrl))
}

/** CLI name a launcher was invoked as: `.../dist/cli/rove.js` -> `rove`. */
export function launcherNameOf(moduleUrl: string): string {
  return basename(fileURLToPath(moduleUrl)).replace(/\.[cm]?[jt]s$/, "")
}

/** The official Bun installer for this platform, as an argv. */
export function bunInstallerCommand(platform: NodeJS.Platform = process.platform): string[] {
  return platform === "win32"
    ? ["powershell", "-NoProfile", "-Command", "irm bun.sh/install.ps1 | iex"]
    : ["bash", "-c", "curl -fsSL https://bun.sh/install | bash"]
}

/** Copy-pasteable install lines, shown when Rove cannot start Bun itself. */
export function missingBunMessage(
  cliName: string = activeCliName(),
  platform: NodeJS.Platform = process.platform,
): string {
  const primary =
    platform === "win32" ? 'powershell -c "irm bun.sh/install.ps1 | iex"' : "curl -fsSL https://bun.sh/install | bash"
  return [
    `${cliName}: Rove runs on the Bun runtime, and no Bun was found on this machine.`,
    "",
    "Install Bun, then run this command again:",
    `  ${primary}`,
    "  npm install -g bun          # any platform, if you already have npm",
    "",
    "Or install Bun and Rove together in one step:",
    "  curl -fsSL https://rove.run/install.sh | sh",
    "",
    `Already have Bun somewhere unusual? Point Rove at it: ${BUN_OVERRIDE_ENV}=/path/to/bun`,
    "",
  ].join("\n")
}

/** Every Bun predates {@link MIN_BUN_VERSION}. Names the binary: upgrading
 *  `~/.bun` does nothing for a Homebrew Bun earlier on PATH. */
export function staleBunMessage(bunPath: string, version: string, cliName: string = activeCliName()): string {
  return [
    `${cliName}: this machine's Bun is too old for Rove — found ${version} at ${bunPath}, need ${MIN_BUN_VERSION} or newer.`,
    "",
    "Rove's terminals are built on Bun's PTY API. An older Bun ignores it silently,",
    "so every terminal and engine tab would open empty and stay empty.",
    "",
    "Upgrade Bun, then run this command again:",
    "  bun upgrade                 # Bun installed itself (~/.bun)",
    "  brew upgrade bun            # Homebrew",
    "  npm install -g bun@latest   # npm-managed Bun",
    "",
    `Have a newer Bun elsewhere? Point Rove at it: ${BUN_OVERRIDE_ENV}=/path/to/bun`,
    `Run on this one anyway (unsupported, terminals will be blank): ${SKIP_VERSION_CHECK_ENV}=1`,
    "",
  ].join("\n")
}

/** A Bun is on disk but won't run. Distinct from "no Bun found", which would
 *  send the user in circles. */
export function unusableBunMessage(bunPath: string, cliName: string = activeCliName()): string {
  return [
    `${cliName}: the Bun at ${bunPath} could not be run — \`${bunPath} --version\` failed or never returned.`,
    "",
    "Rove skipped it rather than starting through it, which would hang or fail",
    "with a message from that binary instead of this one.",
    "",
    "Reinstall Bun, then run this command again:",
    "  curl -fsSL https://bun.sh/install | bash",
    "",
    `Have a working Bun elsewhere? Point Rove at it: ${BUN_OVERRIDE_ENV}=/path/to/bun`,
    "",
  ].join("\n")
}

/** Whether the launcher may offer to install Bun (needs consent, so needs a TTY). */
export function canOfferBunInstall(
  env: NodeJS.ProcessEnv = process.env,
  input: { isTTY?: boolean } = process.stdin,
  output: { isTTY?: boolean } = process.stdout,
): boolean {
  if (env[NO_BOOTSTRAP_ENV] === "1") return false
  if (env.CI === "true" || env.CI === "1") return false
  return Boolean(input.isTTY && output.isTTY)
}

type Spawn = (command: string, args: readonly string[], options: object) => SpawnSyncReturns<Buffer>

/** Run the official Bun installer; returns the Bun path it produced, if any. */
export function installBun(lookup: BunLookup = {}, spawn: Spawn = spawnSync): string | null {
  const platform = lookup.platform ?? process.platform
  const [command, ...args] = bunInstallerCommand(platform)
  if (!command) return null
  const result = spawn(command, args, { stdio: "inherit" })
  if (result.error || result.status !== 0) return null
  // The installer edits rc files, not our PATH, so re-probe — version-aware, or
  // a stale Bun earlier on PATH would be handed back again.
  return resolveUsableBun(lookup).bun
}

/** Exit code for a re-exec'd child, mapping a fatal signal the way a shell does. */
export function exitCodeOf(result: Pick<SpawnSyncReturns<Buffer>, "status" | "signal">): number {
  if (typeof result.status === "number") return result.status
  if (result.signal) return 128 + (Object.hasOwn(SIGNAL_NUMBERS, result.signal) ? SIGNAL_NUMBERS[result.signal] : 0)
  return 1
}

const SIGNAL_NUMBERS: Record<string, number> = { SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 }

/** Re-exec the real Bun entry, inheriting stdio so the TUI owns the terminal. */
export function relaunchWithBun(bun: string, entry: string, argv: readonly string[], spawn: Spawn = spawnSync): number {
  const result = spawn(bun, [entry, ...argv], { stdio: "inherit" })
  if (result.error) {
    process.stderr.write(`rove: could not start Bun at ${bun}: ${result.error.message}\n`)
    return 1
  }
  return exitCodeOf(result)
}

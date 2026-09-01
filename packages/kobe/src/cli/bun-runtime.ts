/**
 * Bun discovery + relaunch for the published `rove` / `kobe` bins.
 *
 * Rove's CLI bundle is a Bun program, but the bin file is started by whatever
 * runtime the installer chose: `bun install -g` symlinks it (Bun runs it),
 * while `npm install -g` and `npx` hand it to node. So the bin ships as a
 * small node launcher that finds a Bun runtime and re-execs the real entry
 * through it — which is also how a machine with npm but no Bun still gets a
 * working `rove` (the launcher offers to install Bun once).
 *
 * Everything in this file must run under plain node: no Bun globals, no
 * imports that pull the Bun bundle in.
 *
 * Deliberately NOT solved by declaring `bun` an optionalDependency (owner,
 * reaffirmed 2026-08-19): that downloads a ~90MB platform binary on EVERY
 * install, including `bun install -g`, where a Bun is already present. The
 * install offer below costs nothing and covers the same gap; the npm-package
 * path stays a lookup candidate for anyone who installs `bun` themselves.
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
export const NO_BOOTSTRAP_ENV = "ROVE_NO_BUN_BOOTSTRAP"
/** Set to `1` to run on a Bun below {@link MIN_BUN_VERSION} anyway (unsupported). */
export const SKIP_VERSION_CHECK_ENV = "ROVE_SKIP_BUN_CHECK"

/**
 * Oldest Bun this build runs on, read from `package.json#engines.bun`.
 *
 * The requirement is real and load-bearing: the terminal backend spawns with
 * Bun's PTY option (`Bun.spawn(…, { terminal })`, src/tui/panes/terminal/pty.ts),
 * which an older Bun drops as an unknown option — no error, no PTY, no output.
 * NOBODY enforces `engines` for us: `bun install` ignores the field outright and
 * npm only honours it under `engine-strict`, so a too-old machine installs
 * cleanly and then runs a Rove whose every terminal tab is silently dead. This
 * constant is what turns that into a sentence the user can act on.
 *
 * `engines.bun` is the single source of truth; scripts/install.sh carries the
 * same floor and test/architecture/bun-version-floor.test.ts holds the three in sync.
 */
export const MIN_BUN_VERSION: string = pkg.engines.bun.match(/\d+\.\d+\.\d+/)?.[0] ?? "0.0.0"

/** A Bun that exists and runs, but predates {@link MIN_BUN_VERSION}. */
export interface StaleBun {
  readonly path: string
  readonly version: string
}

/** What {@link resolveUsableBun} found: a Bun to run, and/or the too-old one it skipped. */
export interface BunResolution {
  readonly bun: string | null
  readonly stale: StaleBun | null
}

export interface BunLookup {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  home?: string
  /** Directory of the launcher, used to find a Bun installed beside the package. */
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

/** `bun --version` for one candidate, or null when it cannot be asked. */
const defaultBunVersionOf = (path: string): string | null => {
  const result = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 5_000 })
  if (result.error || result.status !== 0) return null
  return result.stdout?.split("\n")[0]?.trim() || null
}

/** `1.3.14`, `v1.3.14`, `1.3.14-canary.3` -> `1.3.14`; null when it isn't a version at all. */
export function parseBunVersion(raw: string): string | null {
  return raw.trim().match(/^v?(\d+\.\d+\.\d+)/)?.[1] ?? null
}

/**
 * Whether a reported Bun version clears the floor.
 *
 * Deliberately fails OPEN on anything unparseable: this predicate gates
 * starting Rove at all, and a Bun whose `--version` we cannot read is a worse
 * reason to refuse than the PTY bug is to proceed.
 *
 * Not `version.ts`'s `compareSemver` — everything in this file runs under plain
 * node before any Bun exists, and that module reaches the Bun bundle.
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
 * First candidate that both runs and clears {@link MIN_BUN_VERSION}, plus the
 * oldest-first stale one it walked past.
 *
 * Skipping rather than stopping matters: a system Bun on PATH shadowing a
 * current `~/.bun` one is the common shape of this, and Rove works fine if it
 * just uses the newer one. Costs one `bun --version` per candidate until the
 * first hit (~4ms), paid only on the node launcher path, which is already
 * about to pay for a full re-exec.
 */
export function resolveUsableBun(lookup: BunLookup = {}): BunResolution {
  const isExecutable = lookup.isExecutable ?? defaultIsExecutable
  const versionOf = lookup.bunVersionOf ?? defaultBunVersionOf
  if (bunVersionCheckDisabled(lookup.env ?? process.env)) {
    return { bun: resolveBunBinary(lookup), stale: null }
  }
  let stale: StaleBun | null = null
  for (const candidate of bunCandidates(lookup)) {
    if (!isExecutable(candidate)) continue
    const raw = versionOf(candidate)
    if (raw === null || isBunAtLeast(raw)) return { bun: candidate, stale }
    stale ??= { path: candidate, version: parseBunVersion(raw) ?? raw }
  }
  return { bun: null, stale }
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

/**
 * Shown when every Bun on the machine predates {@link MIN_BUN_VERSION}.
 *
 * Names the binary and its version, because the fix depends on which one it is
 * — upgrading `~/.bun` does nothing for a Homebrew Bun earlier on PATH.
 */
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
  // The installer edits shell rc files, not this process's PATH, so re-probe
  // the well-known prefixes rather than trusting PATH to have grown. Version-
  // aware, or an install run to escape a stale Bun would hand back that same
  // stale Bun whenever it sits earlier on PATH than the fresh `~/.bun` one.
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

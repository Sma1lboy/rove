/**
 * Install + detect the agent skill that teaches a coding agent to drive
 * `kobe api`. Installation goes through `npx skills add`, which owns the
 * registry of ~75 agents and where each reads skills from; we don't
 * reimplement it.
 *
 * Source is the skill bundled in the npm package ({@link bundledSkillDir}):
 * cloning `Sma1lboy/rove` to deliver one SKILL.md is effectively
 * un-installable on a slow connection. {@link SKILL_SOURCE_SLUG} is the
 * fallback for people without Rove.
 *
 * `kobe skill status` is the reliable check; the startup hint is best-effort
 * (the opentui screen takeover can scroll it off).
 */

import { accessSync, existsSync, constants as fsConstants, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { activeCliName } from "../cli/rename-compat.ts"
import { ROVE_PRODUCT_NAME } from "../product.ts"
import { getPersistedString, setPersistedString } from "../state/repos.ts"

/**
 * SKILL.md guidance version this build expects. Bump in lockstep with the
 * `<!-- rove-skill-version: N -->` marker in `.agents/skills/kobe/SKILL.md`
 * whenever the instructions change meaningfully. An installed marker below
 * this is STALE and prompts a re-install.
 *
 * Staleness compares markers, never content, so
 * `test/architecture/skill-version-bump.test.ts` fails any content change
 * that skips the bump.
 */
export const KOBE_SKILL_VERSION = 51

/**
 * Where an installed skill can be found, relative to a home/project root —
 * not `KOBE_HOME_DIR`, since agents read the real home/project.
 *
 * The agent-skills CLI writes the real file into `.agents/skills` and
 * symlinks agent dirs at it (`--copy` opts out); `existsSync` follows
 * symlinks, so either path is a genuine install. `.claude` also catches
 * skills installed by older kobe versions.
 */
const ROVE_SKILL_REL_PATHS = [".agents/skills/rove/SKILL.md", ".claude/skills/rove/SKILL.md"] as const
const LEGACY_SKILL_REL_PATHS = [".agents/skills/kobe/SKILL.md", ".claude/skills/kobe/SKILL.md"] as const
const SKILL_REL_PATHS = [...ROVE_SKILL_REL_PATHS, ...LEGACY_SKILL_REL_PATHS] as const

/** The invoked wrapper command a user runs. Shown in hints / doctor. */
export function skillInstallCommand(env: NodeJS.ProcessEnv = process.env): string {
  return `${activeCliName(env)} skill install`
}

/** Fallback source (and the route for people without Rove); resolving it means a large clone. */
const SKILL_SOURCE_SLUG = "Sma1lboy/rove"

/**
 * The skill directory shipped inside this install, or null (e.g. an unbuilt
 * checkout). Repo layout first, then the packaged `dist/skills` copy.
 */
export function bundledSkillDir(): string | null {
  const here = fileURLToPath(import.meta.url)
  const candidates = [
    resolve(here, "../../../../../.agents/skills/kobe"), // dev: repo root .agents/skills/kobe
    resolve(here, "../../skills/rove"), // packaged: dist/skills/rove
  ]
  return candidates.find((dir) => existsSync(join(dir, "SKILL.md"))) ?? null
}

/** Options shared by the argv/command/install helpers below. */
export interface NpxSkillsOpts {
  agent?: string | readonly string[]
  source?: string | null
  /** Install user-level (`--global`) — the default; `false` = project-level. */
  global?: boolean
}

/**
 * Build the `npx skills add …` argv. `source` defaults to the bundled dir (a
 * local path skips the network), else the repo slug.
 *
 * Global by default: `kobe api` is machine-wide (one daemon, one task
 * store), and per-project copies re-prompt staleness in every repo.
 *
 * Omitting `--agent` lets the CLI detect agents and prompt; pass `agent` only
 * when the user asked for one. The CLI wants one flag per agent — it rejects
 * `--agent claude-code,codex`.
 */
export function npxSkillsArgv(opts: NpxSkillsOpts = {}): string[] {
  const source = opts.source !== undefined ? opts.source : bundledSkillDir()
  const agents = opts.agent === undefined ? [] : typeof opts.agent === "string" ? [opts.agent] : opts.agent
  return [
    "skills",
    "add",
    source ?? SKILL_SOURCE_SLUG,
    "--skill",
    ROVE_PRODUCT_NAME,
    ...(opts.global === false ? [] : ["--global"]),
    ...agents.flatMap((a) => ["--agent", a]),
  ]
}

/** The full underlying command string, for display in help / hints. */
export function npxSkillsCommand(opts: NpxSkillsOpts = {}): string {
  return `npx ${npxSkillsArgv(opts).join(" ")}`
}

/** Exit code when `npx` isn't on PATH — the shell's "command not found", so `exited ${code}` stays true. */
export const NPX_MISSING_EXIT = 127

/**
 * True when `npx` is absent from PATH — the default after the QUICKSTART's
 * install.sh, which installs Bun and Rove but never Node. Walks PATH instead
 * of `Bun.which` so it also runs under vitest/node.
 */
export function isNpxMissing(): boolean {
  const parts = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  // No PATH at all: don't invent a failure — let the spawn report the truth.
  if (parts.length === 0) return false
  return !parts.some((dir) => {
    try {
      accessSync(join(dir, "npx"), fsConstants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

/** The "install Node" message shown wherever a missing `npx` blocks the install. */
function npxMissingMessage(): string {
  return `${activeCliName()} skill install needs \`npx\` (part of Node.js), which isn't on your PATH.\nInstall Node.js (https://nodejs.org) and run it again — the Rove installer only installs Bun and Rove.`
}

/**
 * Run `npx skills add …` with inherited stdio (the CLI's agent picker is
 * interactive); returns the exit code. Checks for `npx` first: `Bun.spawn`
 * throws on a missing binary and no caller catches, so it would surface as
 * `rove failed to start`.
 */
export async function runNpxSkillsInstall(agent?: string | readonly string[], global?: boolean): Promise<number> {
  if (isNpxMissing()) {
    process.stderr.write(`\n${npxMissingMessage()}\n\n`)
    return NPX_MISSING_EXIT
  }
  const proc = Bun.spawn(["npx", ...npxSkillsArgv({ ...(agent === undefined ? {} : { agent }), global })], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  return await proc.exited
}

/** Persisted flag: the one-time startup hint has already been shown. */
const HINT_SEEN_KEY = "skillHintSeen"

/** Record that the user already answered "install the skill?" (onboarding decline), so {@link maybeHintSkillInstall} doesn't re-ask. */
export function markSkillHintSeen(): void {
  setPersistedString(HINT_SEEN_KEY, "1")
}

/** Candidate install locations in priority order: home, then the current project. */
export function kobeSkillPaths(opts: { home?: string; cwd?: string } = {}): string[] {
  const home = opts.home ?? homedir()
  const cwd = opts.cwd ?? process.cwd()
  return [home, cwd].flatMap((root) => SKILL_REL_PATHS.map((rel) => join(root, rel)))
}

/** Parse the canonical marker or an installed legacy marker. */
export function parseSkillVersion(content: string): number | null {
  const m = content.match(/(?:rove|kobe)-skill-version:\s*(\d+)/)
  return m ? Number.parseInt(m[1], 10) : null
}

export interface SkillState {
  readonly installed: boolean
  /** Marker version of the installed skill (null if installed but unstamped). */
  readonly installedVersion: number | null
  /** What this binary expects ({@link KOBE_SKILL_VERSION}). */
  readonly currentVersion: number
  /** Installed, stamped, and behind the binary → re-install recommended. */
  readonly stale: boolean
  /**
   * `kobe`-named copies beside the reported install. Agents load every skill
   * dir they find, so one keeps teaching an old `kobe api` surface however
   * current the `rove` copy is.
   */
  readonly legacyCopies: readonly SkillCopy[]
  /** Where the reported copy lives (null when nothing is installed). */
  readonly path: string | null
}

/** One skill file on disk: where it is and which marker version it carries. */
interface SkillCopy {
  readonly path: string
  readonly version: number | null
}

/** Marker version of a skill file, or null when absent/unreadable/unstamped. */
function skillVersionAt(path: string): number | null {
  try {
    return parseSkillVersion(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

/** `dev:ino`, so a `.claude` symlink into `.agents` counts as one copy. */
function inodeKey(path: string): string {
  try {
    const stat = statSync(path)
    return `${stat.dev}:${stat.ino}`
  } catch {
    return path
  }
}

/** Existing skill files under `roots`, deduplicated by inode. */
function distinctSkillFiles(roots: readonly string[], rels: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const root of roots) {
    for (const rel of rels) {
      const path = join(root, rel)
      if (!existsSync(path)) continue
      const key = inodeKey(path)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(path)
    }
  }
  return out
}

/**
 * Skill dirs under one home, canonical and legacy, deduplicated by inode. For
 * the plugin migration gate: with the plugin enabled every hand-installed
 * copy is a double registration.
 */
export function installedSkillDirs(home: string = homedir()): string[] {
  return distinctSkillFiles([home], SKILL_REL_PATHS).map((path) => dirname(path))
}

/** Installed skill vs the version this binary expects. Unstamped = stale (refreshed once); absent = not installed, not stale. */
export function kobeSkillState(opts: { home?: string; cwd?: string } = {}): SkillState {
  const roots = [opts.home ?? homedir(), opts.cwd ?? process.cwd()]
  const roveCopies = distinctSkillFiles(roots, ROVE_SKILL_REL_PATHS).map((path) => ({
    path,
    version: skillVersionAt(path),
  }))
  const legacy = distinctSkillFiles(roots, LEGACY_SKILL_REL_PATHS).map((path) => ({
    path,
    version: skillVersionAt(path),
  }))
  // Highest-version canonical copy, so a stale duplicate can't make a current
  // install look out of date; a legacy-only install still reports installed.
  const best = [...roveCopies].sort((a, b) => (b.version ?? -1) - (a.version ?? -1))[0] ?? legacy[0]
  if (!best) {
    return {
      installed: false,
      installedVersion: null,
      currentVersion: KOBE_SKILL_VERSION,
      stale: false,
      legacyCopies: [],
      path: null,
    }
  }
  const stale = best.version === null || best.version < KOBE_SKILL_VERSION
  return {
    installed: true,
    installedVersion: best.version,
    currentVersion: KOBE_SKILL_VERSION,
    stale,
    legacyCopies: legacy.filter((copy) => copy.path !== best.path),
    path: best.path,
  }
}

/**
 * True when an installed SKILL.md's text differs from the bundled one — the
 * second opinion `skill status` reports, since staleness only reads the
 * marker. `false` with no bundled copy, so an unbuilt checkout can't warn.
 */
export function installedSkillDiffersFromBundled(installedPath: string): boolean {
  const bundled = bundledSkillDir()
  if (!bundled) return false
  try {
    return readFileSync(join(bundled, "SKILL.md"), "utf8") !== readFileSync(installedPath, "utf8")
  } catch {
    return false
  }
}

/** "…/skills/kobe/SKILL.md (v30)", joined — what a user has to go delete. */
function describeLegacyCopies(copies: readonly SkillCopy[]): string {
  return copies.map((c) => `${c.path}${c.version === null ? "" : ` (v${c.version})`}`).join(", ")
}

/** Test seams for the startup prompt (presence of `ask` marks the session interactive). */
export interface SkillHintIO {
  /** Read one line of user input. */
  ask?: () => Promise<string>
  /** Run the install flow; returns the exit code. */
  install?: () => Promise<number>
}

/** Read one line from stdin (cooked mode — runs before any screen takeover). */
function promptLine(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.resume()
    process.stdin.once("data", (d) => {
      process.stdin.pause()
      resolve(String(d))
    })
  })
}

/**
 * Best-effort startup notice when the kobe skill is absent or out of date.
 *   - absent → one-time hint to install (gated on {@link HINT_SEEN_KEY}).
 *   - stale + interactive terminal → prompt: yes (install now) / no (ask
 *     again next launch) / don't notify for this version (persists
 *     `HINT_SEEN_KEY:vN`, so the next skill-version bump prompts again).
 *   - stale + non-TTY → the one-shot stderr hint, gated per version.
 * Safe to call on every startup.
 */
export async function maybeHintSkillInstall(io: SkillHintIO = {}): Promise<void> {
  // The enabled Rove Claude Code plugin bundles its own skill (versioned with
  // the plugin); nudging `skill install` beside it would create the double
  // registration the migration gate warns about. `skill status` still reports.
  const { isRovePluginEnabled } = await import("../engine/claude-code-local/plugin-migration.ts")
  if (isRovePluginEnabled()) return
  const cliName = activeCliName()
  const installCommand = skillInstallCommand()
  const state = kobeSkillState()
  if (!state.installed) {
    if (getPersistedString(HINT_SEEN_KEY) === "1") return
    setPersistedString(HINT_SEEN_KEY, "1")
    process.stderr.write(
      `\n${cliName}: the Rove agent skill isn't installed — install it so your coding agent can drive Rove via \`${cliName} api\`:\n  ${installCommand}\n  (wraps \`${npxSkillsCommand()}\`; check anytime with \`${cliName} doctor\`)\n\n`,
    )
    return
  }
  const key = `${HINT_SEEN_KEY}:v${state.currentVersion}`
  const duplicates = state.legacyCopies
  // A leftover `kobe` copy: same one-per-version gate, no prompt — nothing to
  // install, only something to delete.
  if (!state.stale) {
    if (duplicates.length === 0) return
    if (getPersistedString(key) === "1") return
    setPersistedString(key, "1")
    process.stderr.write(
      `\n${cliName}: your Rove agent skill is current, but a stale duplicate is still installed:\n  ${describeLegacyCopies(
        duplicates,
      )}\n  Remove that directory — your agent loads both.\n\n`,
    )
    return
  }

  if (getPersistedString(key) === "1") return
  const was = state.installedVersion === null ? "an older version" : `v${state.installedVersion}`

  const interactive = io.ask !== undefined || Boolean(process.stdin.isTTY && process.stderr.isTTY)
  if (!interactive) {
    setPersistedString(key, "1")
    process.stderr.write(
      `\n${cliName}: your Rove agent skill is out of date (${was}; this Rove wants v${state.currentVersion}) — refresh it so \`${cliName} api\` guidance matches:\n  ${installCommand}\n\n`,
    )
    return
  }

  process.stderr.write(
    `\n${cliName}: a new version of the Rove agent skill is available (${was} → v${state.currentVersion}).\nUpdate now? [y]es / [n]o / [d]on't notify for this version: `,
  )
  const answer = (await (io.ask ?? promptLine)()).trim().toLowerCase()
  if (answer === "y" || answer === "yes") {
    const code = await (io.install ?? runNpxSkillsInstall)()
    if (code === 0) process.stderr.write(`${cliName}: skill updated.\n`)
    else process.stderr.write(`${cliName}: skill update failed (exit ${code}) — run \`${installCommand}\` manually.\n`)
  } else if (answer.startsWith("d")) {
    setPersistedString(key, "1")
  }
  // anything else = "no": ask again next launch, nothing persisted.
}

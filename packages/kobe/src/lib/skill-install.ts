/**
 * Install + detect the kobe agent skill.
 *
 * The skill teaches a coding agent when and how to drive `kobe api` (the
 * full task-lifecycle CLI). Installation runs through the Vercel Labs
 * agent-skills CLI (`npx skills add`), which owns the part that is genuinely
 * hard to maintain: the registry of ~75 coding agents, where each one reads
 * its skills from, which get a real directory vs a symlink into the shared
 * `.agents/skills`. kobe does NOT reimplement any of that.
 *
 * What Rove changes is the packaged SOURCE. The public fallback is the
 * canonical `Sma1lboy/rove` repository; `--skill rove` selects the skill.
 * Cloning the repository
 * (`git clone --depth 1`) means a huge working tree just to deliver one
 * SKILL.md, which is effectively un-installable on a slow connection. But a
 * user running `kobe skill install` already HAS kobe, and the skill ships
 * inside the npm package, so the CLI is pointed at that local copy instead:
 * {@link bundledSkillDir}. No clone, no network. The published repo slug
 * stays available as {@link SKILL_SOURCE_SLUG} for people without kobe.
 *
 * Reliable check: `kobe skill status`. The startup hint
 * here is best-effort (the opentui screen takeover can scroll it off).
 * Absent skill → one-shot hint, never nags. Stale skill on an interactive
 * terminal → a yes / no / don't-notify-this-version prompt (runs before the
 * screen takeover); "no" re-asks next launch, "don't notify" mutes that
 * skill version, non-TTY falls back to the one-shot hint.
 */

import { accessSync, existsSync, constants as fsConstants, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { activeCliName } from "../cli/rename-compat.ts"
import { ROVE_PRODUCT_NAME } from "../product.ts"
import { getPersistedString, setPersistedString } from "../state/repos.ts"

/**
 * Version of the SKILL.md guidance THIS Rove build expects. Bump it (in
 * lockstep with the `<!-- rove-skill-version: N -->` marker in
 * `.agents/skills/kobe/SKILL.md`, retained as the repository compatibility
 * source path) whenever the skill's instructions change
 * meaningfully — e.g. the `kobe api` surface grows. An installed skill whose
 * marker is below this number is STALE: the binary moved on, the skill
 * didn't, so we prompt the developer to re-run the active CLI's
 * `skill install` command.
 */
export const KOBE_SKILL_VERSION = 42

/**
 * Where an installed kobe skill can be FOUND, relative to a home/project
 * root. Not kobe's `KOBE_HOME_DIR` — agents read skills from the real
 * project/home regardless of kobe's state-dir.
 *
 * Two locations because the agent-skills CLI writes the real file into the
 * shared `.agents/skills` and SYMLINKS agent-specific dirs at it (that's its
 * default; `--copy` opts out). `existsSync` follows symlinks, so either path
 * answering is a genuine install. `.claude` stays in the list so skills
 * installed by older kobe versions still register as present.
 */
const ROVE_SKILL_REL_PATHS = [".agents/skills/rove/SKILL.md", ".claude/skills/rove/SKILL.md"] as const
const LEGACY_SKILL_REL_PATHS = [".agents/skills/kobe/SKILL.md", ".claude/skills/kobe/SKILL.md"] as const
const SKILL_REL_PATHS = [...ROVE_SKILL_REL_PATHS, ...LEGACY_SKILL_REL_PATHS] as const

/** The invoked wrapper command a user runs. Shown in hints / doctor. */
export function skillInstallCommand(env: NodeJS.ProcessEnv = process.env): string {
  return `${activeCliName(env)} skill install`
}

/**
 * The public repo slug. Only a FALLBACK now (and the documented route for
 * people who don't have Rove installed): resolving it means a large clone.
 */
const SKILL_SOURCE_SLUG = "Sma1lboy/rove"

/**
 * The skill directory shipped inside this install, or null in an environment
 * where it isn't present (an unbuilt source checkout). Candidates mirror
 * `web-cmd.ts`'s dist-asset lookup: repo layout first, then the packaged
 * copy the build emits into `dist/skills`.
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
 * Build the `npx skills add …` argv. `source` is the bundled directory when
 * we have one (a local path — the CLI validates it and skips the network
 * entirely) and the repo slug otherwise.
 *
 * GLOBAL by default: the skill drives `kobe api`, which is machine-wide
 * (one daemon, one task store), and a per-project copy re-prompts staleness
 * in every repo separately. `global: false` opts back into project-level.
 *
 * Agent SELECTION is deliberately left to the agent-skills CLI: omitting
 * `--agent` makes it detect the installed agents and prompt, which is the
 * one part of this we never want to reimplement — that registry covers ~75
 * agents and changes constantly. Pass `agent` only when the user asked for
 * a specific one. Note the CLI wants a repeated flag per agent, not a
 * comma-joined list (it rejects `--agent claude-code,codex`).
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

/**
 * Exit code {@link runNpxSkillsInstall} returns when `npx` isn't on PATH.
 * 127 is the shell's own "command not found" code, so callers that only
 * print `exited ${code}` still say something true.
 */
export const NPX_MISSING_EXIT = 127

/**
 * True when `npx` is absent from PATH. The install.sh path the QUICKSTART
 * recommends installs Bun and Rove but never Node, so this is the DEFAULT
 * state for anyone who followed it — not an edge case.
 *
 * Walks PATH directly rather than using `Bun.which`, so the same code runs
 * (and is testable) under the vitest/node track as under Bun.
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
 * Run the `npx skills add …` install flow, inheriting stdio (so the CLI's
 * own agent picker is fully interactive). Returns the npx exit code.
 *
 * Checks for `npx` FIRST: `Bun.spawn` THROWS on a missing binary (unlike
 * `spawnSync`, which returns `status: undefined`), and no caller on this path
 * catches — the throw would escape all the way to `main().catch` and print
 * `rove failed to start: Executable not found in $PATH: "npx"`. Returning
 * {@link NPX_MISSING_EXIT} keeps the callers' existing exit-code contract.
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

/**
 * Record that the user has already answered the "install the skill?" question,
 * so {@link maybeHintSkillInstall} never re-asks it on the next launch. The
 * onboarding wizard's DECLINE branch calls this: the user said no seconds ago,
 * and nagging them on stderr on the very next `rove` is the same question
 * asked twice.
 */
export function markSkillHintSeen(): void {
  setPersistedString(HINT_SEEN_KEY, "1")
}

/**
 * Candidate install locations, in priority order: the user's home dir,
 * then the current project. `home`/`cwd` are injectable for tests; they
 * default to the OS home and the current working directory.
 */
export function kobeSkillPaths(opts: { home?: string; cwd?: string } = {}): string[] {
  const home = opts.home ?? homedir()
  const cwd = opts.cwd ?? process.cwd()
  return [home, cwd].flatMap((root) => SKILL_REL_PATHS.map((rel) => join(root, rel)))
}

/** True if the Rove skill or a legacy Kobe-named install is present. */
export function isKobeSkillInstalled(opts?: { home?: string; cwd?: string }): boolean {
  return kobeSkillPaths(opts).some((p) => existsSync(p))
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
   * `kobe`-named copies sitting BESIDE the reported install. Agents load every
   * skill directory they find, so one of these keeps teaching an old `kobe api`
   * surface no matter how current the `rove` copy is — and reporting only the
   * first path found made the whole thing invisible.
   */
  readonly legacyCopies: readonly SkillCopy[]
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
 * Skill DIRECTORIES present under one home, canonical and legacy names alike,
 * deduplicated by inode. The plugin migration gate uses this: with the plugin
 * enabled every hand-installed copy is a double registration, whatever it is
 * called and whichever agent dir it landed in.
 */
export function installedSkillDirs(home: string = homedir()): string[] {
  return distinctSkillFiles([home], SKILL_REL_PATHS).map((path) => dirname(path))
}

/**
 * Inspect the installed skill vs the version this binary expects. An
 * UNSTAMPED installed skill (pre-versioning) is treated as stale so it gets
 * refreshed once. An absent skill is "not installed" (not stale).
 */
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
  // Report from the BEST canonical copy — highest marker version — so a stale
  // duplicate can never make a current install look out of date. Falling back
  // to a legacy copy keeps a pre-rename-only install reporting as installed.
  const best = [...roveCopies].sort((a, b) => (b.version ?? -1) - (a.version ?? -1))[0] ?? legacy[0]
  if (!best) {
    return {
      installed: false,
      installedVersion: null,
      currentVersion: KOBE_SKILL_VERSION,
      stale: false,
      legacyCopies: [],
    }
  }
  const stale = best.version === null || best.version < KOBE_SKILL_VERSION
  return {
    installed: true,
    installedVersion: best.version,
    currentVersion: KOBE_SKILL_VERSION,
    stale,
    legacyCopies: legacy.filter((copy) => copy.path !== best.path),
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
  // Plugin takeover: when the Rove Claude Code plugin is enabled
  // it BUNDLES the skill, and that copy versions with the plugin — not with
  // KOBE_SKILL_VERSION. Both the install nudge and the staleness prompt step
  // aside: nagging the user to `skill install` alongside the plugin's copy
  // would create exactly the double registration the migration gate warns
  // about. `kobe skill status` still reports the npx-installed state for
  // anyone running both deliberately (e.g. for non-Claude agents).
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
  // A leftover `kobe` copy is as actionable as staleness — agents load every
  // skill dir they find, so it keeps teaching an old `api` surface next to the
  // current one. Same one-per-version gate; no prompt, since there is nothing
  // to install, only something to delete.
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

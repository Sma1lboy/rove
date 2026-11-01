/**
 * The Rove agent skill (teaches a coding agent to drive `rove api`): where it
 * is installed and how to install it. Data in, data out — no stdout, stdin or
 * exit here; `cli/skill-cmd.ts`, doctor, onboarding and the daemon boot only
 * present or schedule what this returns.
 *
 * Install is a plain copy of the skill bundled with this build into each
 * engine's user-level skills dir. Which engines and which dirs is engine-owned
 * (`EngineRegistryEntry.skillsDir`); this module never names a vendor.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { engineEntry, identifiableEngineIds } from "../engine/registry.ts"
import type { VendorId } from "../types/vendor.ts"

/**
 * SKILL.md guidance version this build expects. Bump in lockstep with the
 * `<!-- rove-skill-version: N -->` marker in `.agents/skills/rove/SKILL.md`
 * whenever the instructions change meaningfully. An installed marker below
 * this is outdated and gets refreshed.
 *
 * Staleness compares markers, never content, so
 * `test/architecture/skill-version-bump.test.ts` fails any content change
 * that skips the bump.
 */
export const ROVE_SKILL_VERSION = 95

/** The skill's directory name inside an engine's skills dir. */
const SKILL_NAME = "rove"

/**
 * The skill directory shipped inside this install, or null (e.g. an unbuilt
 * checkout). Repo layout first, then the packaged `dist/skills` copy.
 */
export function bundledSkillDir(): string | null {
  const here = fileURLToPath(import.meta.url)
  const candidates = [
    resolve(here, "../../../../../.agents/skills/rove"), // dev: repo root .agents/skills/rove
    resolve(here, "../../skills/rove"), // packaged: dist/skills/rove
  ]
  return candidates.find((dir) => existsSync(join(dir, "SKILL.md"))) ?? null
}

/** Parse the `rove-skill-version: N` marker. */
export function parseSkillVersion(content: string): number | null {
  const m = content.match(/rove-skill-version:\s*(\d+)/)
  return m ? Number.parseInt(m[1], 10) : null
}

/** `outdated` covers an older marker AND no marker (pre-versioning installs). */
export type SkillCopyState = "installed" | "outdated" | "not-installed"

/** One engine set up on this machine, and the Rove skill copy it would load. */
export interface SkillTarget {
  readonly vendor: VendorId
  readonly displayName: string
  /** `<engine skills dir>/rove`. */
  readonly dir: string
  readonly state: SkillCopyState
  /** Marker of the copy on disk; null when absent or unstamped. */
  readonly version: number | null
}

/** What is on disk at one `<engine skills dir>/rove`. Never throws. */
export function readSkillCopy(dir: string): { state: SkillCopyState; version: number | null } {
  let text: string
  try {
    text = readFileSync(join(dir, "SKILL.md"), "utf8")
  } catch {
    return { state: "not-installed", version: null }
  }
  const version = parseSkillVersion(text)
  return { state: version !== null && version >= ROVE_SKILL_VERSION ? "installed" : "outdated", version }
}

/** `<skills dir>/rove` for one engine, or null when it isn't set up or takes no skill. */
export function engineSkillDir(vendor: VendorId): string | null {
  const base = engineEntry(vendor).skillsDir?.()
  return base ? join(base, SKILL_NAME) : null
}

/**
 * Every engine that declares a skills dir and is set up here. Engines sharing
 * one dir (the common `~/.agents/skills`) collapse to the first.
 */
export function skillTargets(): SkillTarget[] {
  const seen = new Set<string>()
  const out: SkillTarget[] = []
  for (const vendor of identifiableEngineIds()) {
    const dir = engineSkillDir(vendor)
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    out.push({ vendor, displayName: engineEntry(vendor).displayName, dir, ...readSkillCopy(dir) })
  }
  return out
}

/** Aggregate for one-line surfaces (doctor). */
export interface SkillOverview {
  readonly targets: readonly SkillTarget[]
  /** At least one engine has a copy (current or not). */
  readonly installed: boolean
  /** Copies that need a refresh. */
  readonly outdated: readonly SkillTarget[]
}

export function skillOverview(targets: readonly SkillTarget[] = skillTargets()): SkillOverview {
  return {
    targets,
    installed: targets.some((t) => t.state !== "not-installed"),
    outdated: targets.filter((t) => t.state === "outdated"),
  }
}

export interface SkillInstallResult {
  readonly target: SkillTarget
  /** Null on success. */
  readonly error: string | null
}

/**
 * Write file by file instead of `cpSync`: a dir installed by the agent-skills
 * CLI is often a symlink into `~/.agents/skills`, and writing through it
 * refreshes the real copy instead of replacing the link.
 */
function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else writeFileSync(to, readFileSync(from))
  }
}

/** Copy the bundled skill into each target. Throws only when nothing is bundled. */
export function installSkill(
  targets: readonly SkillTarget[],
  source: string | null = bundledSkillDir(),
): SkillInstallResult[] {
  if (!source) throw new Error("this Rove build ships no bundled skill")
  return targets.map((target) => {
    try {
      copyTree(source, target.dir)
      return { target, error: null }
    } catch (error) {
      return { target, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

/**
 * Refresh copies that are already installed but outdated; never creates one
 * the user didn't ask for. Run on daemon boot, which follows every upgrade.
 */
export function refreshOutdatedSkills(source: string | null = bundledSkillDir()): SkillInstallResult[] {
  const outdated = skillOverview().outdated
  if (outdated.length === 0 || !source) return []
  return installSkill(outdated, source)
}

/**
 * The Settings action (TUI and web): install into every set-up engine that
 * lacks a current copy. Returns one line naming what failed, or null.
 */
export function installSkillErrors(source: string | null = bundledSkillDir()): string | null {
  try {
    const failed = installSkill(
      skillTargets().filter((t) => t.state !== "installed"),
      source,
    ).filter((r) => r.error)
    return failed.length === 0 ? null : failed.map((r) => `${r.target.displayName}: ${r.error}`).join("; ")
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** True when an installed SKILL.md differs from the bundled one (an edit without a version bump). */
export function installedSkillDiffersFromBundled(dir: string): boolean {
  const bundled = bundledSkillDir()
  if (!bundled) return false
  try {
    return readFileSync(join(bundled, "SKILL.md"), "utf8") !== readFileSync(join(dir, "SKILL.md"), "utf8")
  } catch {
    return false
  }
}

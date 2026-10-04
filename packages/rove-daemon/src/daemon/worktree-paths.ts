/**
 * Canonical filesystem layout for Rove-managed worktrees — the ONE derivation
 * both packages read.
 *
 * A managed worktree lives at `<worktrees-root>/<repo-key>/<slug>`. The root
 * defaults to `<home>/.rove/worktrees` and is relocated wholesale by the user's
 * `worktree.basePath` setting; `<repo-key>` is `<basename>-<sha1-12>` of the
 * repo path, so two repos never collide under a shared base.
 *
 * Lives in kobe-daemon (kobe -> kobe-daemon, never back) because both sides
 * compute it: the orchestrator to create/list worktrees, the daemon's
 * `cwd-task.ts` to recognize one an engine started in. Separate copies drift
 * into silent adoption failures.
 *
 * I/O stays with each caller (kobe's State Store owns the corrupt-file
 * backup; the daemon reads best-effort). Only the INTERPRETATION is shared,
 * via {@link normalizeWorktreeBase}, so the two never disagree about what a
 * `state.json` means.
 *
 * `repo` is always absolute. Callers must normalize before invoking.
 */

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { LEGACY_KOBE_STATE_DIR_BASENAME, ROVE_STATE_DIR_BASENAME } from "../compat-env.ts"
import { defaultUiPrefsStatePath, resolveProductHomeDir } from "./product-paths.ts"

/** Directory under Rove's state dir holding all of its worktrees. */
const WORKTREE_ROOT_DIR = "worktrees"

export const REPO_LOCAL_ROVE_WORKTREE_ROOT_SUBPATH = ".rove/worktrees"
export const REPO_LOCAL_KOBE_WORKTREE_ROOT_SUBPATH = ".kobe/worktrees"
export const LEGACY_KOBE_WORKTREE_ROOT_SUBPATH = ".claude/worktrees"

/**
 * Repo-local compatibility roots. Creation does not use these; recognition and
 * listing keep old task records working.
 */
export const REPO_LOCAL_MANAGED_WORKTREE_ROOT_SUBPATHS = [
  REPO_LOCAL_ROVE_WORKTREE_ROOT_SUBPATH,
  REPO_LOCAL_KOBE_WORKTREE_ROOT_SUBPATH,
  LEGACY_KOBE_WORKTREE_ROOT_SUBPATH,
] as const

/** `state.json` key holding the raw, un-normalized worktree base override. */
export const WORKTREE_BASE_KEY = "worktree.basePath"

/** Leading-segment token that expands to the task's project root. */
export const PROJECT_DIR_TOKEN = "$project_dir"

/** The per-repo directory name under a worktrees root: `<basename>-<sha1-12>`. */
export function repoWorktreeDirName(repo: string): string {
  const base = path.basename(repo) || "repo"
  const safeBase = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo"
  const hash = createHash("sha1").update(path.resolve(repo)).digest("hex").slice(0, 12)
  return `${safeBase}-${hash}`
}

/** True iff `raw` starts with `$project_dir` as its first path segment. */
export function hasProjectDirToken(raw: string): boolean {
  const trimmed = raw.trim()
  return (
    trimmed === PROJECT_DIR_TOKEN ||
    trimmed.startsWith(`${PROJECT_DIR_TOKEN}/`) ||
    (process.platform === "win32" && trimmed.startsWith(`${PROJECT_DIR_TOKEN}\\`))
  )
}

/**
 * Normalize a raw user-entered base path to an absolute directory, or `null`
 * when it's unset/blank (meaning "use Rove's default root").
 *
 * `~` / `~/` expands to the OS home, and relative paths resolve against it
 * too (never the process cwd).
 *
 * A leading `$project_dir` expands to `projectDir` (the task's repo root),
 * `..` collapsed, so `$project_dir/../wt` lands beside each project. With
 * the token but no `projectDir`, returns `null` (default root) rather than
 * a literal `$project_dir` directory.
 */
export function normalizeWorktreeBase(raw: string | undefined | null, projectDir?: string): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (hasProjectDirToken(trimmed)) {
    if (!projectDir) return null
    const rest = trimmed.slice(PROJECT_DIR_TOKEN.length).replace(process.platform === "win32" ? /^[/\\]+/ : /^\/+/, "")
    return path.resolve(projectDir, rest)
  }
  const home = resolveProductHomeDir()
  if (trimmed === "~") return home
  const tilde = trimmed.startsWith("~/") || (process.platform === "win32" && trimmed.startsWith("~\\"))
  const expanded = tilde ? path.join(home, trimmed.slice(2)) : trimmed
  return path.isAbsolute(expanded) ? expanded : path.resolve(home, expanded)
}

/**
 * Daemon-side read of the base override. A missing / malformed `state.json`
 * yields `null`; never moves the file aside — the daemon must not rewrite a
 * user file it merely observes.
 */
export function readWorktreeBaseOverride(projectDir?: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(defaultUiPrefsStatePath(), "utf8")) as unknown
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
    const value = (raw as Record<string, unknown>)[WORKTREE_BASE_KEY]
    return normalizeWorktreeBase(typeof value === "string" ? value : null, projectDir)
  } catch {
    return null
  }
}

/** The built-in default worktrees root, ignoring any override. */
export function defaultLocalWorktreesRoot(): string {
  return path.join(resolveProductHomeDir(), ROVE_STATE_DIR_BASENAME, WORKTREE_ROOT_DIR)
}

/** Pre-rename global root. Existing worktree records and discovery keep it live. */
export function legacyLocalWorktreesRoot(): string {
  return path.join(resolveProductHomeDir(), LEGACY_KOBE_STATE_DIR_BASENAME, WORKTREE_ROOT_DIR)
}

/**
 * Absolute path of the ACTIVE worktree root for `repo` — where a new task's
 * worktree is created. `override` is the already-normalized base (see
 * {@link normalizeWorktreeBase}), or `null` for the built-in default.
 *
 * Example: `worktreeRootFor("/Users/x/proj", null)` →
 * `/Users/x/.rove/worktrees/proj-a1b2c3d4e5f6`.
 */
export function worktreeRootFor(repo: string, override: string | null): string {
  if (!path.isAbsolute(repo)) {
    throw new Error(`worktreeRootFor: repo must be an absolute path, got: ${repo}`)
  }
  return path.join(override ?? defaultLocalWorktreesRoot(), repoWorktreeDirName(repo))
}

/**
 * Every worktree root Rove recognizes for `repo`: the active root first, then
 * the built-in default (pre-override worktrees stay listable and block slug
 * reuse), the legacy global root, and the repo-local roots.
 *
 * KNOWN LIMITATION: past override paths aren't persisted. Re-pointing the
 * base from A to B drops A's worktrees from listing + slug allocation; the
 * tasks still work since each record pins its absolute `worktreePath`.
 */
export function managedWorktreeRootsFor(repo: string, override: string | null): readonly string[] {
  if (!path.isAbsolute(repo)) {
    throw new Error(`managedWorktreeRootsFor: repo must be an absolute path, got: ${repo}`)
  }
  const dirName = repoWorktreeDirName(repo)
  return [
    ...new Set([
      worktreeRootFor(repo, override),
      path.join(defaultLocalWorktreesRoot(), dirName),
      path.join(legacyLocalWorktreesRoot(), dirName),
      ...REPO_LOCAL_MANAGED_WORKTREE_ROOT_SUBPATHS.map((subpath) => path.join(repo, subpath)),
    ]),
  ]
}

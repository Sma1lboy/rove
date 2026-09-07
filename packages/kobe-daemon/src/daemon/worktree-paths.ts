/**
 * Canonical filesystem layout for Rove-managed worktrees — the ONE derivation
 * both packages read.
 *
 * A managed worktree lives at `<worktrees-root>/<repo-key>/<slug>`. The root
 * defaults to `<home>/.rove/worktrees` and is relocated wholesale by the user's
 * `worktree.basePath` setting; `<repo-key>` is `<basename>-<sha1-12>` of the
 * repo path, so two repos never collide under a shared base.
 *
 * This lives in kobe-daemon (kobe -> kobe-daemon, never back) because BOTH
 * sides compute it: the TUI/orchestrator to CREATE and list worktrees, and the
 * daemon's `cwd-task.ts` to recognize one an engine started inside. They used
 * to hold separate copies, and the copies drifted — the daemon's never learned
 * about the base override, so a user who moved their worktree location got
 * silent adoption failures. Same move `product-paths.ts` and
 * `lib/poll-scheduling.ts` already made.
 *
 * I/O policy stays with each caller: kobe reads `state.json` through its State
 * Store (which owns the corrupt-file backup), the daemon reads it here with a
 * plain best-effort read. Only the INTERPRETATION of the stored value is
 * shared, via {@link normalizeWorktreeBase} — the two must never disagree
 * about what a given `state.json` means.
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
  return trimmed === PROJECT_DIR_TOKEN || trimmed.startsWith(`${PROJECT_DIR_TOKEN}/`)
}

/**
 * Normalize a raw user-entered base path to an absolute directory, or `null`
 * when it's unset/blank (meaning "use Rove's default root").
 *
 * A leading `~` / `~/` expands to the OS home; relative paths resolve against
 * it too, so a user who types `code/worktrees` gets a stable absolute location
 * instead of one that depends on the process's cwd.
 *
 * A leading `$project_dir` segment expands to `projectDir` (the repo root of
 * the task being created), with `..` segments collapsed — so
 * `$project_dir/../wt` lands next to each project. When the token is present
 * but no `projectDir` context exists (a global read with no repo at hand), the
 * result is `null`: fall back to the default root rather than inventing a
 * literal `$project_dir` directory.
 */
export function normalizeWorktreeBase(raw: string | undefined | null, projectDir?: string): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (hasProjectDirToken(trimmed)) {
    if (!projectDir) return null
    const rest = trimmed.slice(PROJECT_DIR_TOKEN.length).replace(/^\/+/, "")
    return path.resolve(projectDir, rest)
  }
  const home = resolveProductHomeDir()
  if (trimmed === "~") return home
  const expanded = trimmed.startsWith("~/") ? path.join(home, trimmed.slice(2)) : trimmed
  return path.isAbsolute(expanded) ? expanded : path.resolve(home, expanded)
}

/**
 * Daemon-side read of the configured base override. Best-effort and read-only:
 * a missing / malformed `state.json` yields `null` (the default root), and
 * unlike kobe's State Store this never moves the file aside — the daemon must
 * not rewrite a user file it merely observes.
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
 * Absolute paths of every worktree root Rove recognizes for `repo`. The active
 * root (override-aware) is first; the built-in default follows when an override
 * moved it (so worktrees created before the override stay discoverable for
 * listing + slug allocation), then the legacy global root and the repo-local
 * roots that older task records used.
 *
 * KNOWN LIMITATION: only the CURRENT override and the built-in default are
 * recognized — we don't persist a history of past override paths. If a user
 * points the base at A, creates tasks, then re-points it at B, the worktrees
 * under A fall out of managed listing + slug allocation. Those tasks are NOT
 * lost — each task record pins its own absolute `worktreePath`, so
 * opening/removing them keeps working; they just stop appearing in "list
 * Rove-managed worktrees" and their slugs stop blocking reuse. Recording every
 * base ever used would close the gap but is deliberately out of scope here.
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

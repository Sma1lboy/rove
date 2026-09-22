/**
 * Saved-repos persistence: the non-reactive accessor (for CLI verbs like
 * `kobe add`) to the same `~/.config/rove/state.json` the TUI's React `KV`
 * wraps. `savedRepos` is a `string[]` of repo paths the user added.
 *
 * All writes go through `store.ts` read-merge-write transactions, so
 * concurrent writers never erase each other's keys. A running TUI won't see
 * an external addition until restart — deliberately no file watching.
 */

import { spawnSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { pathIdentity, samePath } from "@sma1lboy/kobe-daemon/path-identity"
import { kvStatePath } from "../env.ts"
import { recordSpawn } from "../lib/spawn-profile.ts"
import { type ProjectIntent, type ProjectRejection, projectRejection } from "./project-eligibility.ts"
import { isRemoteRepoKey, readRemoteRepos } from "./remote-repos.ts"
import { type StateSnapshot, loadStateFile, patchStateFile, readSavedRepos, updateStateFile } from "./store.ts"

// Re-exported so importers of this module keep working.
export {
  addRemoteRepo,
  getRemoteRepoConfig,
  getRemoteRepos,
  isRemoteProjectsEnabled,
  isRemoteRepoKey,
  remoteRepoKey,
} from "./remote-repos.ts"
export type { RemoteAuthConfig, RemoteRepoConfig } from "./remote-repos.ts"

/**
 * Resolve `absPath` to its git toplevel. A "main" task's worktreePath must be
 * the repo root: FileTree's `git ls-files --full-name` emits toplevel-relative
 * paths, so a saved subdirectory would render rooted at the monorepo root.
 *
 * Returns `absPath` itself when it isn't in a git repo, or already is the
 * toplevel by realpath (macOS `/var/...` is kept, not rewritten to `/private/var/...`).
 */
export function resolveRepoRoot(absPath: string): string {
  // Remote keys are synthetic URLs; pass through as the stable savedRepos key.
  if (isRemoteRepoKey(absPath)) return absPath
  recordSpawn("repos.resolveRepoRoot", ["git", "rev-parse", "--show-toplevel"], absPath)
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: absPath,
    encoding: "utf8",
    shell: false,
  })
  if (r.status !== 0) return absPath
  const top = (r.stdout ?? "").trim()
  if (!top) return absPath
  try {
    if (realpathSync(absPath) === realpathSync(top)) return absPath
  } catch {
    // broken symlink / vanished dir — use the toplevel string as-is
  }
  return top
}

/**
 * Whether `absPath` is inside a local git work tree. Rejects garbage like
 * `kobe add ,` before it becomes a saved project the TUI cannot delete. A
 * missing or non-repo `cwd` gives a non-zero or null status → false. Remote
 * (`ssh://…`) keys are validated by the remote-add flow, not here.
 */
export function isGitRepo(absPath: string): boolean {
  if (isRemoteRepoKey(absPath)) return false
  recordSpawn("repos.isGitRepo", ["git", "rev-parse", "--is-inside-work-tree"], absPath)
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: absPath,
    encoding: "utf8",
    shell: false,
  })
  return r.status === 0 && (r.stdout ?? "").trim() === "true"
}

/**
 * Whether git accepts `branch` as a branch name. Asked of git itself: the
 * rules are a long tail (`..`, `@{`, `.lock`, leading `-`, control bytes) and
 * the authority must be the program that later runs `git worktree add -b`.
 * Pure string check, no repo needed. `-rf`-style names are safe: fixed argv
 * (`shell: false`) and git reads `--branch`'s value positionally.
 */
export function isValidBranchName(branch: string): boolean {
  const r = spawnSync("git", ["check-ref-format", "--branch", branch], { encoding: "utf8", shell: false })
  return r.status === 0
}

/**
 * Resolve a local path to the repository's PRIMARY checkout. `git rev-parse
 * --show-toplevel` returns the linked worktree when called from a task
 * worktree; scripted task creation wants the source repo instead so new tasks
 * do not nest under another task's worktree.
 */
export function resolveMainRepoRoot(absPath: string): string {
  if (isRemoteRepoKey(absPath)) return absPath
  recordSpawn("repos.resolveMainRepoRoot", ["git", "worktree", "list", "--porcelain"], absPath)
  const r = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: absPath,
    encoding: "utf8",
    shell: false,
  })
  if (r.status !== 0) return resolveRepoRoot(absPath)
  const first = (r.stdout ?? "")
    .split(/\r?\n/)
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length)
    .trim()
  return first || resolveRepoRoot(absPath)
}

/**
 * Where the shared KV blob lives. Resolved on each access so a test's
 * `KOBE_HOME_DIR` override works without module-init reload tricks.
 */
export function statePath(): string {
  return kvStatePath()
}

export function getSavedRepos(): readonly string[] {
  return readSavedRepos(loadStateFile())
}

/**
 * Read a string from the shared state.json, for processes without the TUI's
 * `useKV`. `undefined` when absent or non-string.
 */
export function getPersistedString(key: string): string | undefined {
  const value = loadStateFile()[key]
  return typeof value === "string" ? value : undefined
}

/**
 * Unnarrowed read. {@link getPersistedString} drops non-strings, so a numeric
 * threshold would read as absent and fall back to the default while another
 * surface honours it.
 */
export function getPersistedValue(key: string): unknown {
  return loadStateFile()[key]
}

/**
 * Persist one key via {@link patchStateFile}. Writers merge only the keys they
 * changed, so last write wins only on the SAME key, never a sibling.
 */
export function setPersistedString(key: string, value: string): void {
  patchStateFile({ [key]: value })
}

/**
 * Ids of user-registered custom engines (state.json `customEngineIds`; never
 * built-in ids). Name + command live in the same flat keys as built-ins
 * (`engineName.<id>` / `engineCommand.<id>`). Written by Settings via its kv.
 */
export function getCustomEngineIds(): readonly string[] {
  const raw = loadStateFile().customEngineIds
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
}

/**
 * Engine ids switched OFF in Settings → Engines (`disabledEngineIds`). A
 * disabled engine keeps its overrides; it is just not offered for new tasks.
 */
export function getDisabledEngineIds(): readonly string[] {
  const raw = loadStateFile().disabledEngineIds
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
}

export type AddResult = {
  added: boolean
  path: string
  total: number
  /** Set when the path was refused — see {@link projectRejection}. `added`
   *  is false and nothing was written. */
  rejected?: ProjectRejection
}

export interface AddSavedRepoOpts {
  /** How the path was chosen — see {@link ProjectIntent}. Defaults to
   *  `"explicit"`: every production caller reaches here from a user naming
   *  the repo (`rove add`, the new-task dialog, a quick-fork). */
  readonly intent?: ProjectIntent
  /**
   * Skip the admission gate. ONLY for tests of the persistence mechanics
   * with stand-in paths; production must never pass it — the gate lives
   * inside because callers cannot be trusted to remember it.
   */
  readonly skipGate?: boolean
}

/**
 * Append `absPath` to `savedRepos` if it is eligible and not already present.
 * Returns whether the entry was newly added and the resulting list size.
 *
 * The input is stored as the repository's PRIMARY checkout
 * ({@link resolveMainRepoRoot}): a subdirectory or linked worktree never mints
 * a second project row. The returned `path` is that normalized form.
 *
 * `resolveMainRepoRoot`, not `resolveRepoRoot`, to match `rove api add --repo`:
 * `note.file` routing compares `t.repo === author.repo` as exact strings, and
 * git's porcelain path also collapses symlink/case variants that would give
 * one repo two `~/.rove/worktrees/<key>` roots.
 *
 * The admission gate runs HERE on the normalized path so no caller can skip it
 * (unvalidated fixtures/sandbox paths become unremovable projects). Refusal is
 * returned as `rejected`, not thrown: most callers are opportunistic and must
 * not fail their real work over it.
 */
export function addSavedRepo(absPath: string, opts: AddSavedRepoOpts = {}): AddResult {
  // Resolve BEFORE the transaction: a git subprocess inside the
  // read-merge-write window would widen the race.
  const normalized = resolveMainRepoRoot(absPath)
  // Gate the RESOLVED path so a subdirectory of a rejected repo can't slip through.
  const rejected = opts.skipGate ? null : projectRejection(normalized, isGitRepo, opts.intent ?? "explicit")
  if (rejected) return { added: false, path: normalized, total: getSavedRepos().length, rejected }
  let result: AddResult = { added: false, path: normalized, total: 0 }
  updateStateFile((state) => {
    const cur = readSavedRepos(state)
    if (cur.some((repo) => samePath(repo, normalized))) {
      result = { added: false, path: normalized, total: cur.length }
      return false // already present — leave the file untouched
    }
    state.savedRepos = [...cur, normalized]
    result = { added: true, path: normalized, total: cur.length + 1 }
    return undefined
  })
  return result
}

/**
 * Backfill `savedRepos` from existing project rows, so sidebar projects and
 * new-task picker repos stay the same set (a row missing from `savedRepos` is
 * unpickable and, once hidden, unrecoverable).
 *
 * `mainRepos` are the caller's `kind:"main"` task repos (the daemon owns the
 * index). Gate failures are skipped, not healed — a leaked fixture row must
 * not become MORE permanent. Returns the paths actually added.
 */
export function backfillSavedReposFromProjects(mainRepos: readonly string[]): readonly string[] {
  const added: string[] = []
  for (const repo of mainRepos) {
    // `explicit`: these rows are already in the user's sidebar. The stricter
    // tier is for paths Rove is about to infer, not ones it has been showing.
    if (addSavedRepo(repo, { intent: "explicit" }).added) added.push(repo)
  }
  return added
}

/**
 * Migration: rewrite `savedRepos` so each entry is its repository's primary
 * checkout, de-duping entries that collapse to one root (state written before
 * {@link addSavedRepo} normalized). No-op when already canonical.
 */
export function normalizeSavedRepos(): void {
  // Resolve (a subprocess per entry) outside the read-merge-write window.
  const cur = getSavedRepos()
  const seen = new Set<string>()
  const next: string[] = []
  let changed = false
  for (const p of cur) {
    const top = resolveMainRepoRoot(p)
    if (top !== p) changed = true
    if (seen.has(pathIdentity(top))) {
      changed = true
      continue
    }
    seen.add(pathIdentity(top))
    next.push(top)
  }
  if (!changed) return
  patchStateFile({ savedRepos: next })
}

/**
 * Per-user init override (state.json `repoConfigs`), keyed by git toplevel.
 * FALLBACK only — in-repo `.rove/` files win (see
 * {@link ../state/repo-init.ts resolveRepoInit}).
 */
export interface RepoInitOverride {
  readonly initScript?: string
  readonly initPrompt?: string
}

function readRepoConfigs(state: StateSnapshot): Record<string, RepoInitOverride> {
  const raw = state.repoConfigs
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, RepoInitOverride>
}

function coerceOverride(entry: unknown): RepoInitOverride {
  if (!entry || typeof entry !== "object") return {}
  const e = entry as Record<string, unknown>
  return {
    initScript: typeof e.initScript === "string" && e.initScript.length > 0 ? e.initScript : undefined,
    initPrompt: typeof e.initPrompt === "string" && e.initPrompt.length > 0 ? e.initPrompt : undefined,
  }
}

/** Read the per-user state.json override for a repo (by git toplevel). */
export function getRepoInitOverride(repoRoot: string): RepoInitOverride {
  const configs = readRepoConfigs(loadStateFile())
  const normalized = resolveRepoRoot(repoRoot)
  const key = Object.keys(configs).find((key) => samePath(key, normalized)) ?? normalized
  return coerceOverride(configs[key])
}

/**
 * Patch a repo's init override. A field set to `""` clears that field; a
 * field left `undefined` is preserved. When both fields end up empty the
 * repo's entry is dropped entirely so state.json stays tidy.
 */
export function setRepoInitOverride(repoRoot: string, patch: RepoInitOverride): RepoInitOverride {
  const resolved = resolveRepoRoot(repoRoot)
  let next: RepoInitOverride = {}
  updateStateFile((state) => {
    const configs = { ...readRepoConfigs(state) }
    const normalized = Object.keys(configs).find((key) => samePath(key, resolved)) ?? resolved
    const cur = coerceOverride(configs[normalized])
    const nextScript = patch.initScript === undefined ? cur.initScript : patch.initScript || undefined
    const nextPrompt = patch.initPrompt === undefined ? cur.initPrompt : patch.initPrompt || undefined
    next = {
      ...(nextScript ? { initScript: nextScript } : {}),
      ...(nextPrompt ? { initPrompt: nextPrompt } : {}),
    }
    if (!next.initScript && !next.initPrompt) {
      const { [normalized]: _dropped, ...rest } = configs
      state.repoConfigs = rest
    } else {
      configs[normalized] = next
      state.repoConfigs = configs
    }
    return undefined
  })
  return next
}

export type RemoveResult = { removed: boolean; path: string; total: number }

/**
 * Remove `absPath` from `savedRepos`; the directory on disk is never touched.
 * Idempotent: an absent path returns `removed: false` without writing.
 */
export function removeSavedRepo(absPath: string): RemoveResult {
  let result: RemoveResult = { removed: false, path: absPath, total: 0 }
  updateStateFile((state) => {
    const cur = readSavedRepos(state)
    if (!cur.some((repo) => samePath(repo, absPath))) {
      result = { removed: false, path: absPath, total: cur.length }
      return false // nothing to remove — leave the file untouched
    }
    const remaining = cur.filter((p) => !samePath(p, absPath))
    state.savedRepos = remaining
    // Drop a remote project's orphaned config; its keychain password is
    // intentionally left untouched (a separate, destructive side effect).
    if (isRemoteRepoKey(absPath)) {
      const remotes = readRemoteRepos(state)
      if (absPath in remotes) {
        const next = { ...remotes }
        delete next[absPath]
        state.remoteRepos = next
      }
    }
    result = { removed: true, path: absPath, total: remaining.length }
    return undefined
  })
  return result
}

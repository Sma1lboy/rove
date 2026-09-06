/**
 * Saved-repos persistence.
 *
 * The TUI's `KV` store (src/tui-react/context/kv.tsx) is a React-context
 * wrapper
 * around `~/.config/rove/state.json`. Outside that context — e.g. from the
 * `kobe add` CLI subcommand — we can't use it. This module is the
 * non-reactive direct accessor for the same on-disk blob: load, mutate,
 * atomic-rename save.
 *
 * The file format is shared with the TUI KV: a flat JSON object whose
 * `savedRepos` key is a `string[]` of repo paths the user has explicitly
 * added. The TUI reads it via `kv.get("savedRepos", [])`; this module
 * reads/writes the same key directly.
 *
 * Concurrency note: all writes go through `src/state/store.ts`, whose
 * read-merge-write transactions keep concurrent writers (the TUI's
 * debounced flush, other panes' `setPersisted*` calls, a `kobe add` from
 * another shell) from erasing each other's keys. A running TUI's
 * in-memory cache still won't reflect an external addition until restart
 * — acceptable; there's deliberately no file watching.
 */

import { spawnSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { kvStatePath } from "../env.ts"
import { type ProjectIntent, type ProjectRejection, projectRejection } from "./project-eligibility.ts"
import { isRemoteRepoKey, readRemoteRepos } from "./remote-repos.ts"
import { type StateSnapshot, loadStateFile, patchStateFile, readSavedRepos, updateStateFile } from "./store.ts"

// The remote-project surface moved to `remote-repos.ts` (see the note there);
// re-exported so existing importers of this module keep working.
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
 * Resolve `absPath` to the git toplevel that owns it. A "main" task's
 * worktreePath must equal the git repo root because FileTree's
 * `git ls-files --full-name` emits paths relative to the toplevel, not
 * the cwd — saving a subdirectory (e.g. `packages/kobe`) makes the
 * tree render rooted at the monorepo root (`packages/...`) while the
 * task label still claims the subdir, confusing the user.
 *
 * Falls back to `absPath` itself when:
 *   - the directory isn't inside a git repo (rev-parse exits non-zero), or
 *   - the input already points at the toplevel (compared by realpath, so
 *     `/var/folders/...` is treated as equal to `/private/var/folders/...`
 *     on macOS rather than being rewritten to the canonical form).
 */
export function resolveRepoRoot(absPath: string): string {
  // A remote project's key is a synthetic `ssh://…` URL, not a local path —
  // there is nothing to canonicalize (and no local git repo to ask). Pass it
  // through untouched so it round-trips as the stable savedRepos key.
  if (isRemoteRepoKey(absPath)) return absPath
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
    // realpath can fail on broken symlinks / vanished dirs — fall
    // through and use the toplevel string as-is.
  }
  return top
}

/**
 * Whether `absPath` points inside a local git work tree. `kobe add` uses this
 * to reject a non-repo argument before it pollutes the saved-projects picker:
 * `kobe add ,` resolves `,` to a directory that doesn't exist (or isn't a
 * repo), and without this guard the garbage path was stored verbatim and then
 * couldn't be deleted from the TUI (it surfaced as a synthetic main row that
 * `deleteTask` refuses). A missing/!-repo `cwd` makes `git` exit non-zero (or
 * `spawnSync` error with a null status), so both cases return false. Remote
 * (`ssh://…`) keys are validated by the remote-add flow, not here.
 */
export function isGitRepo(absPath: string): boolean {
  if (isRemoteRepoKey(absPath)) return false
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: absPath,
    encoding: "utf8",
    shell: false,
  })
  return r.status === 0 && (r.stdout ?? "").trim() === "true"
}

/**
 * Whether git would accept `branch` as a branch name — asked of git itself
 * (`check-ref-format --branch`) rather than reimplemented, because the rules
 * are a long tail (`..`, `@{`, a trailing `.lock`, a leading `-`, control
 * bytes) and the authority has to be the same program that later runs
 * `git worktree add -b`.
 *
 * No repo needed: this is a pure string check, so it runs from wherever the
 * caller is and cannot be confused by the surrounding checkout. `-rf`-style
 * names are safe to pass — the arg vector is fixed (`shell: false`) and git
 * reads `--branch`'s value positionally.
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
 * Read a string value from the shared kv state.json. For standalone
 * processes (the `kobe tasks` pane) that need a kv value but don't host
 * the TUI's reactive `useKV` — e.g. `lastSelectedVendor`. Returns
 * `undefined` when absent or non-string. Atomic read.
 */
export function getPersistedString(key: string): string | undefined {
  const value = loadStateFile()[key]
  return typeof value === "string" ? value : undefined
}

/**
 * Persist a string value into the shared kv state.json: a single-key
 * read-merge-write + atomic rename via {@link patchStateFile}. Pairs with
 * {@link getPersistedString} for standalone processes. Concurrent with the
 * TUI's `useKV` writes, but both merge only the keys they changed, so a
 * write here can't be clobbered by (or clobber) a sibling key from another
 * process — last write wins only on the SAME key.
 */
export function setPersistedString(key: string, value: string): void {
  patchStateFile({ [key]: value })
}

/**
 * The ids of user-registered custom engines (KOB — user-addable engines).
 * Stored under the shared state.json `customEngineIds` key as a `string[]`;
 * each id's display name + launch command live in the SAME flat keys the
 * built-ins use (`engineName.<id>` / `engineCommand.<id>`), so Settings →
 * Engines manages built-in and custom engines through one mechanism. Read
 * cross-process (the new-task selector, the ctrl+T prompt) via this atomic
 * loader; written by the Settings dialog through its reactive kv. Built-in
 * ids are never present here.
 */
export function getCustomEngineIds(): readonly string[] {
  const raw = loadStateFile().customEngineIds
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
}

/**
 * Engine ids the user switched OFF in Settings → Engines, stored under the
 * shared state.json `disabledEngineIds` key. A disabled engine keeps its
 * command and name overrides — it is simply not offered when picking an
 * engine for a task. Read cross-process the same way as
 * {@link getCustomEngineIds}; the Settings dialog writes it through its kv.
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
   * Write the entry without consulting the admission gate.
   *
   * ONLY for exercising the persistence mechanics themselves — atomic
   * rename, sibling-key preservation, list ordering — where the path is an
   * arbitrary stand-in (`/repos/alpha`) and its eligibility is beside the
   * point. Production code must never pass this: the whole reason the gate
   * moved inside this function is that callers cannot be trusted to
   * remember it.
   */
  readonly skipGate?: boolean
}

/**
 * Append `absPath` to `savedRepos` if it is eligible and not already present.
 * Returns whether the entry was newly added and the resulting list size.
 *
 * The input is resolved to the repository's PRIMARY checkout before storage
 * (see {@link resolveMainRepoRoot}) — so `kobe add` from a monorepo
 * subdirectory stores the repo root, not the subdir, and `kobe add <linked
 * worktree>` stores the repository instead of minting a SECOND project row
 * for a repo that is already saved. The returned `path` is the normalized
 * form so callers report what was actually saved.
 *
 * `resolveMainRepoRoot`, not `resolveRepoRoot`: the scripted entry point
 * (`rove api add --repo`) already normalizes that way, so using the git
 * toplevel here made the two entry points disagree about what a repo IS.
 * One repository ended up saved under two paths AND two symlink forms
 * (`/tmp/x` beside `/private/tmp/x`), and `note.file` routing compares
 * `t.repo === author.repo` as an exact string — so a note filed under one row
 * silently never reached the other row's dispatcher. Git's porcelain path is
 * fully resolved, which also collapses the symlink and case-variant spellings
 * that gave one repository two `~/.rove/worktrees/<key>` roots.
 *
 * VALIDATES here rather than leaving it to the caller: of the eight call
 * sites exactly one would do it, and the other
 * seven would put test fixtures and sandbox paths into the user's project
 * list — where nothing could remove them again. The gate lives HERE, applied to
 * the normalized path, so no caller can skip it by forgetting; a refusal
 * comes back as `rejected` rather than an exception, because most callers
 * are opportunistic ("remember this repo while doing something else") and
 * must not fail their real work over it.
 */
export function addSavedRepo(absPath: string, opts: AddSavedRepoOpts = {}): AddResult {
  // Resolve BEFORE the transaction — `git rev-parse` (a subprocess) inside
  // the read-merge-write window would widen the race we're trying to keep
  // narrow.
  const normalized = resolveMainRepoRoot(absPath)
  // Gate the RESOLVED path: a subdirectory of a rejected repo must not slip
  // through by having an innocent-looking name of its own.
  const rejected = opts.skipGate ? null : projectRejection(normalized, isGitRepo, opts.intent ?? "explicit")
  if (rejected) return { added: false, path: normalized, total: getSavedRepos().length, rejected }
  let result: AddResult = { added: false, path: normalized, total: 0 }
  updateStateFile((state) => {
    const cur = readSavedRepos(state)
    if (cur.includes(normalized)) {
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
 * Backfill `savedRepos` from the project rows that already exist.
 *
 * The sidebar's projects and the new-task picker's repos are meant to be the
 * same set, but a row minted by an older kobe could reach the sidebar
 * without ever reaching `savedRepos` — leaving it visible, unpickable, and
 * (once closing the last tab hides a project) not recoverable.
 *
 * `mainRepos` is the caller's list of `kind:"main"` task repos; this module
 * cannot read the task index (the daemon owns it). Entries that fail the
 * admission gate are skipped rather than healed — a leaked fixture row is not
 * something to make MORE permanent. Returns the paths actually added.
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
 * One-shot migration: rewrite the on-disk `savedRepos` list so each entry is
 * its repository's primary checkout. Heals state files written before
 * {@link addSavedRepo} normalized at write time — including the second row a
 * pre-fix `rove add <linked worktree>` left behind. Duplicates that collapse
 * to the same root are de-duped. No-op when every entry is already
 * canonical.
 */
export function normalizeSavedRepos(): void {
  // Resolve toplevels first (subprocess per entry), THEN merge the result
  // in one short read-merge-write so the git calls don't sit inside the
  // transaction window.
  const cur = getSavedRepos()
  const seen = new Set<string>()
  const next: string[] = []
  let changed = false
  for (const p of cur) {
    const top = resolveMainRepoRoot(p)
    if (top !== p) changed = true
    if (seen.has(top)) {
      changed = true
      continue
    }
    seen.add(top)
    next.push(top)
  }
  if (!changed) return
  patchStateFile({ savedRepos: next })
}

/**
 * Per-user, per-repo init override stored under the `repoConfigs` key of
 * the shared state.json. This is the FALLBACK default for a repo that does
 * not ship its own `.rove/init.sh` / `.rove/init-prompt.md` — the in-repo
 * files win (see {@link ../state/repo-init.ts resolveRepoInit}). Keyed by
 * git toplevel so every worktree of the repo resolves the same entry.
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
  return coerceOverride(readRepoConfigs(loadStateFile())[resolveRepoRoot(repoRoot)])
}

/**
 * Patch a repo's init override. A field set to `""` clears that field; a
 * field left `undefined` is preserved. When both fields end up empty the
 * repo's entry is dropped entirely so state.json stays tidy.
 */
export function setRepoInitOverride(repoRoot: string, patch: RepoInitOverride): RepoInitOverride {
  const normalized = resolveRepoRoot(repoRoot)
  let next: RepoInitOverride = {}
  updateStateFile((state) => {
    const configs = { ...readRepoConfigs(state) }
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
 * Remove `absPath` from `savedRepos`. Wired from the
 * sidebar's `d` keypress on a main-task row: the confirm copy is
 * "this will remove '<repo>' from your saved repos. The directory and
 * its files stay on disk." The directory itself is never touched —
 * only the saved-repos list is mutated. Sibling KV keys (themes,
 * lastSelectedTaskId, etc.) are preserved.
 *
 * Idempotent: removing a path that isn't in the list returns
 * `removed: false` and leaves the file untouched.
 */
export function removeSavedRepo(absPath: string): RemoveResult {
  let result: RemoveResult = { removed: false, path: absPath, total: 0 }
  updateStateFile((state) => {
    const cur = readSavedRepos(state)
    if (!cur.includes(absPath)) {
      result = { removed: false, path: absPath, total: cur.length }
      return false // nothing to remove — leave the file untouched
    }
    state.savedRepos = cur.filter((p) => p !== absPath)
    // For a remote project (`ssh://…` key) also drop its connection config so
    // we don't leave an orphan `remoteRepos` entry pointing at a project the
    // user just forgot. The OS-keychain password (a separate, destructive side
    // effect) is intentionally left untouched.
    if (isRemoteRepoKey(absPath)) {
      const remotes = readRemoteRepos(state)
      if (absPath in remotes) {
        const next = { ...remotes }
        delete next[absPath]
        state.remoteRepos = next
      }
    }
    result = { removed: true, path: absPath, total: cur.length - 1 }
    return undefined
  })
  return result
}

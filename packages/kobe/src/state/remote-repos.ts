/**
 * Remote (`ssh://…`) projects: the synthetic savedRepos key and the stored
 * connection config behind it.
 *
 * Split out of `repos.ts`, which owns LOCAL repo paths. A remote project has
 * no local path to canonicalize, no git toplevel to resolve and no project
 * eligibility to check; the two halves share only the state file.
 *
 * Imports `store.ts` only, never `repos.ts` — `repos.ts` imports THIS module,
 * and a value-import cycle between them bundles into a TDZ crash in whichever
 * verb happens to load first.
 */

import { type StateSnapshot, getPersistedBool, loadStateFile, readSavedRepos, updateStateFile } from "./store.ts"

// ── Remote projects (SSH-backed) ─────────────────────────────────────────────
//
// A remote project is a saved repo whose worktrees live on another host over
// SSH. Hosted PTY engine launch over SSH is still pending. Its `savedRepos`
// key is a synthetic `ssh://user@host:port`
// URL (it has no local path), and its connection details live under the
// separate `remoteRepos` map. The PASSWORD is never stored here — only a
// `keychainRef` pointing at the OS keychain (see `exec/keychain.ts`). See
// `docs/design/remote-projects.md`.

/** Persisted auth: a key path, or a pointer to a keychain-stored password. */
export type RemoteAuthConfig =
  | { readonly kind: "key"; readonly keyPath?: string }
  | { readonly kind: "password"; readonly keychainRef: { readonly service: string; readonly account: string } }

export interface RemoteRepoConfig {
  readonly host: string
  readonly user: string
  readonly port?: number
  /** The directory on the remote under which task worktrees are created. */
  readonly basePath: string
  readonly auth: RemoteAuthConfig
}

/** True for a synthetic remote-project key (`ssh://…`). */
export function isRemoteRepoKey(key: string): boolean {
  return key.startsWith("ssh://")
}

/**
 * Whether the experimental SSH-backed remote-projects feature is enabled
 * (Settings → Dev → Experimental). Off by default. Stored as a boolean under
 * the shared state.json `experimental.remoteProjects` key (written by the
 * Settings dialog's reactive kv); read here cross-process so `kobe add
 * --remote` can refuse when the feature is off. See `docs/design/remote-projects.md`.
 */
export function isRemoteProjectsEnabled(): boolean {
  return getPersistedBool("experimental.remoteProjects", false)
}

/**
 * The stable savedRepos key for a remote project:
 * `ssh://user@host[:port][/basePath]`.
 *
 * `basePath` is part of the identity because it is the only thing that tells
 * two projects on one host+user apart. Without it, a second `rove add
 * --remote --host h --user u --path /srv/repoB` overwrote the first's config
 * under the same key and reported it as "updated remote project" — an
 * identity collision presented as a deliberate edit. Every task already
 * recorded against repoA then resolved its worktree root through repoB's
 * `basePath`.
 *
 * Omitted when there is no base path, which is also the LEGACY key shape —
 * see {@link addRemoteRepo} for how already-registered projects keep theirs.
 */
export function remoteRepoKey(host: string, user: string, port?: number, basePath?: string): string {
  const authority = port ? `${user}@${host}:${port}` : `${user}@${host}`
  const base = (basePath ?? "").trim().replace(/\/+$/, "")
  if (!base) return `ssh://${authority}`
  return `ssh://${authority}${base.startsWith("/") ? base : `/${base}`}`
}

export function readRemoteRepos(state: StateSnapshot): Record<string, RemoteRepoConfig> {
  const raw = state.remoteRepos
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, RemoteRepoConfig>
}

/** Read a remote project's connection config, or null when the key isn't remote. */
export function getRemoteRepoConfig(key: string): RemoteRepoConfig | null {
  return readRemoteRepos(loadStateFile())[key] ?? null
}

/** All remote-project configs, keyed by their `ssh://` savedRepos key. */
export function getRemoteRepos(): Readonly<Record<string, RemoteRepoConfig>> {
  return readRemoteRepos(loadStateFile())
}

/**
 * Register a remote project: store its config under `remoteRepos[key]` AND add
 * the synthetic key to `savedRepos` so it shows up as a project. Idempotent on
 * the savedRepos side; the config is overwritten so re-adding updates it.
 */
export function addRemoteRepo(config: RemoteRepoConfig): { key: string; added: boolean } {
  let key = remoteRepoKey(config.host, config.user, config.port, config.basePath)
  let added = false
  updateStateFile((state) => {
    const repos = { ...readRemoteRepos(state) }
    // A project registered before the key carried its base path is keyed
    // `ssh://user@host[:port]`, and its tasks store THAT string as
    // `task.repo`. Re-registering the same project must update that row in
    // place; minting the path-bearing key instead would leave a second
    // sidebar row whose config those tasks never reach.
    const legacyKey = remoteRepoKey(config.host, config.user, config.port)
    if (key !== legacyKey && repos[legacyKey]?.basePath === config.basePath) key = legacyKey
    repos[key] = config
    state.remoteRepos = repos
    const saved = readSavedRepos(state)
    added = !saved.includes(key)
    if (added) state.savedRepos = [...saved, key]
    return undefined
  })
  return { key, added }
}

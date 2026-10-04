/**
 * Remote (`ssh://…`) projects: the synthetic savedRepos key and its stored
 * connection config. `repos.ts` owns local paths; the two share only the state file.
 *
 * Imports `store.ts` only, never `repos.ts` — `repos.ts` imports this module,
 * and a value-import cycle bundles into a TDZ crash in whichever verb loads first.
 */

import { type StateSnapshot, getPersistedBool, loadStateFile, readSavedRepos, updateStateFile } from "./store.ts"

// A remote project's worktrees live on another host over SSH (hosted PTY
// engine launch over SSH is still pending). Connection details live in the
// `remoteRepos` map; the PASSWORD is never stored — only a `keychainRef` into
// the OS keychain (`exec/keychain.ts`). See `docs/design/remote-projects.md`.

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
 * Settings → Dev → Experimental toggle, off by default. Read from state.json
 * cross-process so `kobe add --remote` can refuse when it is off.
 */
export function isRemoteProjectsEnabled(): boolean {
  return getPersistedBool("experimental.remoteProjects", false)
}

/**
 * Stable savedRepos key: `ssh://user@host[:port][/basePath]`.
 *
 * `basePath` is identity — the only thing telling two projects on one
 * host+user apart; without it a second add overwrites the first's config and
 * the first's tasks resolve worktrees through the second's `basePath`.
 * No base path is also the LEGACY key shape — see {@link addRemoteRepo}.
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
    // A legacy-keyed project's tasks store `ssh://user@host[:port]` as
    // `task.repo`; re-registering must update that row in place, not mint a
    // second row whose config those tasks never reach.
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

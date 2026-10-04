/**
 * Resolve an `ExecHost` for a repo (project) key.
 *
 * A LOCAL project (an ordinary path) → `LocalExecHost`. A REMOTE project
 * (`ssh://…` key with a `remoteRepos` entry) → `RemoteExecHost` with its
 * host/user/port, the ControlMaster socket under the Rove home, and the
 * keychain password (read lazily, never persisted in state.json).
 *
 * Remoteness is DERIVED from the repo key, never stored on the Task.
 */

import { existsSync } from "node:fs"
import { homeDir, remoteControlSocketPath } from "../env.ts"
import { type RemoteRepoConfig, getRemoteRepoConfig, getRemoteRepos, isRemoteRepoKey } from "../state/repos.ts"
import { type ExecHost, LocalExecHost, type RemoteAuth, RemoteExecHost, type RemoteSpec } from "./exec-host.ts"
import { getKeychainPassword } from "./keychain.ts"

/** Build the runtime `RemoteSpec` (with a live password getter) from persisted config. */
export function remoteSpecFromConfig(config: RemoteRepoConfig): RemoteSpec {
  const cfgAuth = config.auth
  const auth: RemoteAuth =
    cfgAuth.kind === "key"
      ? { kind: "key", keyPath: cfgAuth.keyPath }
      : { kind: "password", getPassword: () => getKeychainPassword(cfgAuth.keychainRef) }
  return {
    host: config.host,
    user: config.user,
    port: config.port,
    auth,
    controlPath: remoteControlSocketPath(config.host, config.user, config.port),
  }
}

/**
 * `RemoteExecHost` instances, cached by `controlPath` so the sync `ssh -O check`
 * in `ensureReady()` (`masterUp` is per-instance) runs once per master
 * lifetime, not per call — on a cold master it blocks the daemon's event loop
 * on a full ssh connect. `run()` resets `masterUp` on exit 255, so a cached
 * instance self-heals after a dropped ControlPersist socket.
 */
const remoteHostCache = new Map<string, RemoteExecHost>()

function cachedRemoteHost(config: RemoteRepoConfig): RemoteExecHost {
  const spec = remoteSpecFromConfig(config)
  const cached = remoteHostCache.get(spec.controlPath)
  if (cached) return cached
  const host = new RemoteExecHost(spec)
  remoteHostCache.set(spec.controlPath, host)
  return host
}

/**
 * The ExecHost for a project key. Defaults to local; only an `ssh://` key with
 * a stored `remoteRepos` config produces a `RemoteExecHost`. An `ssh://` key
 * with no config (corrupt state) falls back to local rather than throwing —
 * the caller surfaces the missing-config error elsewhere.
 */
export function execHostForRepo(repoKey: string): ExecHost {
  const config = getRemoteRepoConfig(repoKey)
  if (!config) return new LocalExecHost()
  return cachedRemoteHost(config)
}

/**
 * The ExecHost for a WORKTREE path (a path, not a project key). The
 * worktree-side manager methods (`isDirty`, `currentBranch`, `remove`, …)
 * receive only a path, so remoteness is recovered by matching the path
 * against each remote project's `basePath`; a local path gets `LocalExecHost`.
 */
export function execHostForWorktreePath(worktreePath: string): ExecHost {
  for (const config of Object.values(getRemoteRepos())) {
    if (worktreePath === config.basePath || worktreePath.startsWith(`${config.basePath}/`)) {
      return cachedRemoteHost(config)
    }
  }
  return new LocalExecHost()
}

// ── Intent-named queries (the remoteness conditionals live HERE, once) ──────
//
// These helpers own the remoteness derivations so TUI/pane/CLI code asks intent-shaped questions and a third
// adapter only needs changes inside `exec/`.

/**
 * A task's remote-project key (`ssh://…`), or `undefined` for a local repo —
 * THE one place "is this repo remote?" is derived from a repo key.
 */
export function remoteKeyForRepo(repo: string | undefined): string | undefined {
  return repo && isRemoteRepoKey(repo) ? repo : undefined
}

/**
 * Whether a worktree path is usable as a session cwd. A REMOTE path is trusted
 * (created over SSH; a local `existsSync` would wrongly say "missing", and
 * probing remotely costs an SSH round-trip per render). Local paths are checked
 * on disk.
 */
export function worktreeUsable(worktreePath: string): boolean {
  // `isRemote` short-circuits BEFORE the on-disk probe.
  return execHostForWorktreePath(worktreePath).isRemote || existsSync(worktreePath)
}

/**
 * The LOCAL directory a pane/process serving a worktree can be spawned in
 * (tmux `-c`): the worktree itself when local. A REMOTE worktree can't be
 * `cd`'d locally (tmux would refuse to spawn), so panes use the local home dir
 * and the engine pane's wrapped `ssh … 'cd <wt>'` carries the remote dir.
 */
export function localSpawnCwd(worktreePath: string): string {
  return execHostForWorktreePath(worktreePath).isRemote ? homeDir() : worktreePath
}

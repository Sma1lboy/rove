/**
 * Owner-only modes for the state tree, applied as a repair pass on every
 * start: the `mode` option of `mkdirSync`/`writeFileSync` binds only at
 * `O_CREAT`, so a home created without it keeps 0755/0644 forever.
 *
 * `<home>/.rove` matters most: `server.ts` accepts every socket connection
 * with no peer-credential check, and reaching the socket means `add`
 * (arbitrary execution as the owner) and `send`. The directory mode IS the
 * access control, so nothing may assume it without setting it.
 *
 * Best-effort: a failing chmod (foreign owner, read-only mount, no unix
 * modes) must never block boot. A loose mode beats a daemon that won't start.
 */

import { chmodSync } from "node:fs"
import { chmod, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME } from "../compat-env.ts"

/** Directories a local user other than the owner has no business entering. */
export const OWNER_ONLY_DIR_MODE = 0o700
/** Files that are credentials, or that name the owner's repos and sessions. */
export const OWNER_ONLY_FILE_MODE = 0o600

/** chmod that swallows every failure — see the module header on why. */
async function tighten(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode)
  } catch {
    /* absent, not ours, or a filesystem without modes */
  }
}

/** Re-`chmod` an existing directory to 0700. Safe on an absent path. */
export function tightenDirPermissions(dir: string): Promise<void> {
  return tighten(dir, OWNER_ONLY_DIR_MODE)
}

/** Re-`chmod` an existing file to 0600. Safe on an absent path. */
export function tightenFilePermissions(file: string): Promise<void> {
  return tighten(file, OWNER_ONLY_FILE_MODE)
}

/** Sync twin for callers on a synchronous path (`web-token.ts`,
 *  `pty-freeze-store.ts`). Same swallow-everything contract. */
export function tightenDirPermissionsSync(dir: string): void {
  try {
    chmodSync(dir, OWNER_ONLY_DIR_MODE)
  } catch {
    /* absent, not ours, or a filesystem without modes */
  }
}

/** Re-`chmod` an existing file to 0600, synchronously. Safe on an absent path. */
export function tightenFilePermissionsSync(file: string): void {
  try {
    chmodSync(file, OWNER_ONLY_FILE_MODE)
  } catch {
    /* absent, not ours, or a filesystem without modes */
  }
}

/**
 * `mkdir -p` + tighten: `mode` covers a fresh tree, the chmod repairs an
 * existing one. Intermediate parents keep the umask on purpose — `<home>`
 * is the user's, not ours to narrow.
 */
export async function ensureOwnerOnlyDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  await tightenDirPermissions(dir)
}

/**
 * `<home>/.rove`. Keyed on the home, not `dirname(socketPath)`: the socket is
 * overridable (`ROVE_DAEMON_SOCKET_PATH`) and `fitSocketPath` moves it to
 * `$TMPDIR` when `sun_path` would overflow, so its parent may be a shared
 * `/tmp`. A socket outside the state dir relies on its own 0600 mode.
 */
export function ensureOwnerOnlyStateDir(homeDir: string): Promise<void> {
  return ensureOwnerOnlyDir(join(homeDir, ROVE_STATE_DIR_BASENAME))
}

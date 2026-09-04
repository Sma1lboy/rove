/**
 * Owner-only modes for the state tree, applied as a REPAIR pass rather than
 * only at creation.
 *
 * `mkdirSync`/`writeFileSync`'s `mode` option binds at `O_CREAT` and is a
 * silent no-op for a path that already exists. Every install therefore splits
 * into two populations, and only one of them is fixed by getting the creation
 * mode right: a home created before the mode argument landed keeps 0755/0644
 * forever, which is precisely the population that is exposed. So each of these
 * helpers chmods unconditionally, on every start, and not just when it creates
 * the path.
 *
 * This matters most for `<home>/.rove` itself. `server.ts` accepts every
 * connection on the daemon socket with no peer-credential check — a defensible
 * design, but only because the containing directory is supposed to be owner-
 * only. Reaching that socket means `add` (launch an engine — arbitrary
 * execution as the owner) and `send` (text into a live session). The directory
 * mode IS the access-control mechanism, so nothing else in the daemon may
 * assume it without setting it.
 *
 * Best-effort throughout: a chmod that fails (foreign owner, read-only mount,
 * a home on a filesystem with no unix modes) must never keep the daemon from
 * booting. A loose mode is worse than a tight one; neither is worse than a
 * daemon that will not start.
 */

import { chmod, mkdir } from "node:fs/promises"

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

/**
 * `mkdir -p` a state directory AND tighten it.
 *
 * Both halves are required: the `mode` creates a fresh tree correctly, the
 * chmod repairs a tree that already exists. Intermediate parents get the
 * caller's umask, which is deliberate — `<home>` is the user's own directory
 * and not ours to narrow.
 */
export async function ensureOwnerOnlyDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  await tightenDirPermissions(dir)
}

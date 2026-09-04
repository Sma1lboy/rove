/**
 * The message of an unknown thrown value — `Error#message` when it is a real
 * Error, else `String(err)`. The one shared spelling of a pattern used at
 * ~50 call sites.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * A thrown message with its throw-site prefix removed, for text a USER reads.
 *
 * The worktree/task layers prefix their throws with the function that raised
 * them (`create(): <path> exists but is not a registered git worktree`,
 * `setBranch: branch is required`). That prefix earns its keep in
 * `client.log`, but interpolated into a toast it reads as a second, stuttered
 * verb — "Couldn't create the worktree: create(): …" — and names an internal
 * symbol the user cannot act on.
 *
 * Stripped only when the prefix is unmistakably an identifier: it ends in
 * `()`, or it is camelCase with an internal capital. Prose prefixes stay —
 * git's own `fatal: not a git repository` is all-lowercase and parenless, and
 * losing its `fatal:` would change what the line means.
 */
const THROW_SITE_PREFIX = /^(?:[a-z][A-Za-z0-9]*\(\)|[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+): /

export function userFacingErrorMessage(err: unknown): string {
  return errorMessage(err).replace(THROW_SITE_PREFIX, "")
}

/** The message of an unknown thrown value: `Error#message`, else `String(err)`. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * A thrown message with its throw-site prefix removed, for text a USER reads.
 *
 * Worktree/task throws are prefixed with the raising function (`create(): …`,
 * `setBranch: …`) — useful in `client.log`, noise in a toast.
 *
 * Stripped only when unmistakably an identifier: ends in `()`, or camelCase
 * with an internal capital. Prose prefixes like git's `fatal:` stay.
 */
const THROW_SITE_PREFIX = /^(?:[a-z][A-Za-z0-9]*\(\)|[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+): /

export function userFacingErrorMessage(err: unknown): string {
  return errorMessage(err).replace(THROW_SITE_PREFIX, "")
}

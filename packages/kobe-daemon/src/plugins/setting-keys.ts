/**
 * Which env var names a `[[settings]]` row may claim.
 *
 * A key becomes a bare `KEY=value` line in the plugin's config `.env`, which
 * plugin commands source (`. "$ROVE_PLUGIN_CONFIG_DIR/.env"`) — so it lands
 * in the process environment. Rejected at manifest parse time so a bad key
 * never reaches Settings as an editable row.
 */

/** A real env var name only — anything else could smuggle an assignment,
 *  comment, or shell syntax into the `.env`. */
export const SETTING_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Names a settings row may not claim (all pass SETTING_KEY_RE). The line is
 * mechanism, not sensitivity: each changes HOW the process runs (binary
 * resolution, loaded libraries, interpreter flags, shelled-out commands).
 * A plugin may still export them in its own script, just not via a
 * user-editable row where `key = "PATH"` looks like a preference.
 *
 * API-key-shaped names are deliberately absent: asking for a token is the
 * feature, not the attack.
 */
export const RESERVED_SETTING_KEYS = [
  // resolution + identity
  "PATH",
  "HOME",
  "SHELL",
  "IFS",
  // dynamic loader
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
  // interpreter flags / auto-sourced startup files
  "NODE_OPTIONS",
  "BUN_INSPECT",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "PERL5OPT",
  "PERL5LIB",
  "RUBYOPT",
  "BASH_ENV",
  "ENV",
  // "run this command for me" hooks
  "GIT_SSH_COMMAND",
  "GIT_SSH",
  "GIT_EXTERNAL_DIFF",
  "GIT_PAGER",
  "PAGER",
  "EDITOR",
  "VISUAL",
] as const

/** Why `key` may not be used, or null when it is fine. */
export function settingKeyRejection(key: string): string | null {
  if (!SETTING_KEY_RE.test(key)) return `\`${key}\` is not a valid env var name (${SETTING_KEY_RE.source})`
  if ((RESERVED_SETTING_KEYS as readonly string[]).includes(key)) {
    return `\`${key}\` is reserved; it steers how the plugin's own process runs`
  }
  return null
}

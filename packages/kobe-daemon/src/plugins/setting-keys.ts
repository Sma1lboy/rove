/**
 * Which env var names a `[[settings]]` row may claim.
 *
 * A settings key becomes a bare `KEY=value` line in the plugin's config
 * `.env`, and that file is what plugin commands source
 * (`. "$ROVE_PLUGIN_CONFIG_DIR/.env"`). So the key is not a label — it is a
 * variable that lands in the plugin process's environment, with a value the
 * user typed into a row the plugin told them to edit.
 *
 * That makes this a manifest-validation concern rather than a store concern:
 * reject the declaration at parse time, so a bad key never reaches Settings
 * as an editable row in the first place.
 */

/** Must be a real env var name and nothing else — anything outside this
 *  shape could smuggle a second assignment, a comment, or shell syntax into
 *  the `.env`. */
export const SETTING_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Names a settings row may not claim. Every one of these matches
 * SETTING_KEY_RE, so the shape check alone would let them through.
 *
 * The line is mechanism, not sensitivity: each name here changes HOW the
 * plugin's process runs — which binary resolves, which library loads, which
 * interpreter flags apply, which subprocess a tool shells out to — rather
 * than being data the plugin reads. A plugin can still export any of them
 * inside its own script; what it may not do is route one through a row the
 * user is invited to edit, where `label = "Search path"` on `key = "PATH"`
 * reads as an ordinary preference.
 *
 * Deliberately absent: API-key-shaped names. A plugin asking the user to
 * paste a token is the feature, not the attack.
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

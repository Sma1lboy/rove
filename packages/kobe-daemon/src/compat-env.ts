/**
 * Environment compatibility for the staged kobe -> rove rename.
 *
 * Runtime code still reads the established KOBE_* names internally. The
 * public CLI boundary mirrors every ROVE_* value onto its KOBE_* counterpart
 * before starting the daemon, PTY host, TUI, or a child CLI. Keeping the
 * translation here gives every process the same precedence rule:
 *
 *   ROVE_* > KOBE_*
 *
 * Product data now uses the Rove layout. Runtime continuity surfaces (daemon
 * and PTY sockets/pids/logs) and plugins deliberately keep the legacy layout
 * until their own compatibility phases; callers choose the explicit constant
 * that matches the surface they own.
 */

export const ROVE_ENV_PREFIX = "ROVE_"
export const LEGACY_KOBE_ENV_PREFIX = "KOBE_"
export const ROVE_PRODUCT_NAME = "rove" as const
export const LEGACY_KOBE_PRODUCT_NAME = "kobe" as const

export const ROVE_STATE_DIR_BASENAME = ".rove" as const
export const ROVE_CONFIG_DIR_BASENAME = "rove" as const
export const LEGACY_KOBE_STATE_DIR_BASENAME = ".kobe" as const
export const LEGACY_KOBE_CONFIG_DIR_BASENAME = "kobe" as const

/** @deprecated Legacy runtime/plugin layout; prefer an explicit canonical or legacy constant. */
export const COMPAT_STATE_DIR_BASENAME = ".kobe" as const
/** @deprecated Legacy config layout; canonical product data uses `rove`. */
export const COMPAT_CONFIG_DIR_BASENAME = "kobe" as const

export function legacyKobeEnvKey(roveKey: string): string | undefined {
  if (!roveKey.startsWith(ROVE_ENV_PREFIX)) return undefined
  return `${LEGACY_KOBE_ENV_PREFIX}${roveKey.slice(ROVE_ENV_PREFIX.length)}`
}

/**
 * Read one renamed variable without mutating the supplied environment.
 *
 * Blank is UNSET, decided per namespace rather than on the combined result.
 * `VAR=` is how a shell says "unset" — the visual fixture writes
 * `ROVE_TASK_ID=` for exactly that meaning — so a `??` chain over the raw
 * values would treat a DEFINED empty `ROVE_*` as an answer and shadow the
 * real `KOBE_*` beside it. That is not a cosmetic difference for a path: an
 * empty `HOME_DIR` produced `""` as the home and then RELATIVE state paths
 * (`.rove`, `.config/rove/state.json`), relative to whatever the process's
 * cwd happened to be — the user's repository, for the TUI. For the socket
 * and pid overrides it silently dropped an isolated daemon back onto the
 * production one. Blank in the new name means unset, which is exactly when
 * the legacy name is supposed to answer.
 */
export function readRoveEnv(suffix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of [`${ROVE_ENV_PREFIX}${suffix}`, `${LEGACY_KOBE_ENV_PREFIX}${suffix}`]) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return undefined
}

/** `ROVE_HOME_DIR` / `KOBE_HOME_DIR` as a home directory, or `undefined`. */
export function readRoveHomeDirEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return readRoveEnv("HOME_DIR", env)
}

/**
 * Set an explicit control in both namespaces.
 *
 * Internal launchers use this when an isolation or command-line override must
 * beat every inherited value. Writing only KOBE_* is insufficient because a
 * child wrapper will correctly reapply ROVE_* precedence when it starts.
 */
export function setRoveEnv(suffix: string, value: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  env[`${ROVE_ENV_PREFIX}${suffix}`] = value
  env[`${LEGACY_KOBE_ENV_PREFIX}${suffix}`] = value
  return env
}

/**
 * Mirror every public ROVE_* control into the legacy internal namespace.
 * Existing KOBE_* values remain when no new-name value was supplied — and a
 * BLANK `ROVE_*` counts as "not supplied" for the same reason
 * {@link readRoveEnv} does. Mirroring it copied `""` over a real `KOBE_*`,
 * which destroys the value in the one namespace that still had it, so the
 * per-namespace fallback there had nothing left to find.
 */
export function installRoveEnvCompatibility(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value.trim().length === 0 || key === "ROVE_INVOKED_AS") continue
    const legacyKey = legacyKobeEnvKey(key)
    if (legacyKey) env[legacyKey] = value
  }
  return env
}

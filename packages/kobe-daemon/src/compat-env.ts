/**
 * kobe -> rove env compatibility. Runtime reads KOBE_* internally; the CLI
 * boundary mirrors ROVE_* onto KOBE_* before starting any process, so every
 * process shares one precedence rule:
 *
 *   ROVE_* > KOBE_*
 *
 * Product data uses the Rove layout; daemon/PTY sockets, pids, logs and
 * plugins keep the legacy layout. Callers pick the constant for their surface.
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

export function legacyKobeEnvKey(roveKey: string): string | undefined {
  if (!roveKey.startsWith(ROVE_ENV_PREFIX)) return undefined
  return `${LEGACY_KOBE_ENV_PREFIX}${roveKey.slice(ROVE_ENV_PREFIX.length)}`
}

/**
 * Read a renamed variable without mutating `env`. Blank is UNSET, per
 * namespace (`VAR=` is a shell's "unset"; the visual fixture writes
 * `ROVE_TASK_ID=`), so an empty `ROVE_*` never shadows a real `KOBE_*`. An
 * empty `HOME_DIR` otherwise yields RELATIVE state paths under the cwd (the
 * user's repo, for the TUI), and empty socket/pid overrides drop an isolated
 * daemon onto the production one.
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

/** Set in both namespaces so an override beats inherited values: a child
 *  wrapper reapplies ROVE_* precedence, so KOBE_* alone would lose. */
export function setRoveEnv(suffix: string, value: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  env[`${ROVE_ENV_PREFIX}${suffix}`] = value
  env[`${LEGACY_KOBE_ENV_PREFIX}${suffix}`] = value
  return env
}

/**
 * Mirror ROVE_* onto KOBE_*. A blank `ROVE_*` is "not supplied" (see
 * {@link readRoveEnv}): mirroring `""` would destroy the real `KOBE_*` value.
 */
export function installRoveEnvCompatibility(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value.trim().length === 0 || key === "ROVE_INVOKED_AS") continue
    const legacyKey = legacyKobeEnvKey(key)
    if (legacyKey) env[legacyKey] = value
  }
  return env
}

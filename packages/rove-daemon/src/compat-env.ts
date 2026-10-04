export const ROVE_ENV_PREFIX = "ROVE_"
export const ROVE_PRODUCT_NAME = "rove" as const
export const ROVE_STATE_DIR_BASENAME = ".rove" as const
export const ROVE_CONFIG_DIR_BASENAME = "rove" as const

/** Blank overrides are unset so isolation paths never become relative. */
export function readRoveEnv(suffix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[`${ROVE_ENV_PREFIX}${suffix}`]?.trim() || undefined
}

export function readRoveHomeDirEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return readRoveEnv("HOME_DIR", env)
}

export function setRoveEnv(suffix: string, value: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  env[`${ROVE_ENV_PREFIX}${suffix}`] = value
  return env
}

/**
 * TOML value coercion primitives for the plugin manifest: `unknown` → typed
 * value, or a `rove-plugin.toml:`-prefixed error naming the field. Knows no
 * manifest keys; `manifest.ts` owns the shape.
 */

export const PLUGIN_PLATFORMS = ["macos", "linux", "windows"] as const
export type PluginPlatform = (typeof PLUGIN_PLATFORMS)[number]

export class ManifestError extends Error {}

export function fail(message: string): never {
  throw new ManifestError(`rove-plugin.toml: ${message}`)
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`\`${field}\` must be a non-empty string`)
  return value
}

/**
 * A setting's `default` as the stored string; accepts TOML booleans/numbers.
 * `true` → `"1"`, `false` → no default (a boolean is on iff its .env value is `"1"`).
 */
export function asSettingDefault(value: unknown, field: string): string | undefined {
  if (value === undefined || value === false) return undefined
  if (value === true) return "1"
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return asString(value, field)
}

/** `timeout_ms` bounds: the floor stops `= 5` killing every run pre-exec; the ceiling stops hour-long pins. */
export const TIMEOUT_MIN_MS = 100
export const TIMEOUT_MAX_MS = 600_000

/** A hook's deadline override in milliseconds, or undefined when absent. */
export function asTimeoutMs(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isInteger(value) || value < TIMEOUT_MIN_MS || value > TIMEOUT_MAX_MS) {
    fail(`\`${field}\` must be a whole number of milliseconds between ${TIMEOUT_MIN_MS} and ${TIMEOUT_MAX_MS}`)
  }
  return value
}

export function asCommand(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v.length > 0)) {
    fail(`\`${field}\` must be a non-empty array of strings (argv form)`)
  }
  return value
}

export function asPlatforms(value: unknown, field: string): PluginPlatform[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((v) => (PLUGIN_PLATFORMS as readonly string[]).includes(v as string))) {
    fail(`\`${field}\` must be an array drawn from ${PLUGIN_PLATFORMS.join(", ")}`)
  }
  return value as PluginPlatform[]
}

export function asTableArray(value: unknown, field: string): Record<string, unknown>[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((v) => typeof v === "object" && v !== null && !Array.isArray(v))) {
    fail(`\`[[${field}]]\` must be an array of tables`)
  }
  return value as Record<string, unknown>[]
}

/** Non-empty array of strings, or undefined when the key is absent. */
export function asStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v.length > 0)) {
    fail(`\`${field}\` must be a non-empty array of strings`)
  }
  return value as string[]
}

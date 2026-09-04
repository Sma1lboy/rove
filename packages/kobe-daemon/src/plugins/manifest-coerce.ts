/**
 * TOML value coercion for the plugin manifest — the primitives, not the shape.
 *
 * The split from `manifest.ts`: THIS half turns an `unknown` parsed out of TOML
 * into a typed value or throws a `rove-plugin.toml:`-prefixed diagnostic naming
 * the offending field; `manifest.ts` owns what the manifest's fields ARE and in
 * what combinations. Nothing here knows a single manifest key, which is what
 * lets both halves grow without dragging the other along.
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
 * A setting's `default`, coerced to the string every value is stored as.
 * TOML has real booleans and numbers and `type = "boolean"` invites writing
 * `default = true`, which used to fail the whole manifest with "must be a
 * non-empty string". `false` means "no default", matching the storage
 * convention where a boolean is on iff its .env value is `"1"`.
 */
export function asSettingDefault(value: unknown, field: string): string | undefined {
  if (value === undefined || value === false) return undefined
  if (value === true) return "1"
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return asString(value, field)
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

/**
 * Engine vendor id. Built-ins are literals backing the exhaustive maps and
 * history-reader dispatch; the type is open (`string & {}`) because users
 * register custom engines (`state/repos.ts` customEngineIds), whose launch
 * command resolves from `engineCommand.<id>`.
 */
export type VendorId = "claude" | "codex" | "copilot" | "kimi" | (string & {})

/** The first-party engines that ship with kobe (cycle order). */
export const BUILTIN_VENDORS = ["claude", "codex", "copilot", "kimi", "pi", "omp", "bob"] as const
export type BuiltinVendorId = (typeof BUILTIN_VENDORS)[number]

/** Fresh-install default, and where `defaultVendor`/`lastSelectedVendor` land
 *  when their custom engine is deleted. */
export const DEFAULT_VENDOR: BuiltinVendorId = BUILTIN_VENDORS[0]

/** Built-ins only, in cycle order; surfaces offering custom engines compose it with customEngineIds. */
export const ALL_VENDORS: readonly VendorId[] = [...BUILTIN_VENDORS]

/** True when `id` is one of the first-party engines (not a custom one). */
export function isBuiltinVendor(id: string | undefined): id is BuiltinVendorId {
  return id !== undefined && (BUILTIN_VENDORS as readonly string[]).includes(id)
}

/** Next vendor in `list`, wrapping. A `current` not in the list yields the first entry; empty list returns `current`. */
export function nextVendorWithin(list: readonly VendorId[], current: VendorId): VendorId {
  if (list.length === 0) return current
  const i = list.indexOf(current)
  return list[(i + 1) % list.length] ?? list[0] ?? current
}

/** Reverse of {@link nextVendorWithin}. A `current` not in the list yields the last entry; empty list returns `current`. */
export function prevVendorWithin(list: readonly VendorId[], current: VendorId): VendorId {
  if (list.length === 0) return current
  const i = list.indexOf(current)
  if (i < 0) return list[list.length - 1] ?? current
  return list[(i - 1 + list.length) % list.length] ?? current
}

/**
 * Coerce an untrusted string to a {@link VendorId}. Any non-empty value passes
 * (a bogus id just fails to launch); only empty/absent falls back to `"claude"`.
 */
export function coerceVendorId(value: string | undefined): VendorId {
  const v = value?.trim()
  return v && v.length > 0 ? v : "claude"
}

/**
 * Validate a persisted vendor id (e.g. `lastSelectedVendor`). Unlike
 * {@link coerceVendorId}, rejects anything neither built-in nor in
 * `customEngineIds` (`state/repos.ts#getCustomEngineIds`; omit to accept
 * built-ins only), falling back to `"claude"` ({@link DEFAULT_TASK_VENDOR})
 * so a typo can't become the default and silently fail to launch.
 */
export function resolvePersistedVendor(value: string | undefined, customEngineIds: readonly string[] = []): VendorId {
  const v = value?.trim()
  if (!v) return "claude"
  if (isBuiltinVendor(v)) return v
  if (customEngineIds.includes(v)) return v
  return "claude"
}

/**
 * Keymap RUNTIME: lookup index, chord resolution, override reset, reload
 * version store. The table DATA and its contract live in
 * `keybindings-table.ts`, re-exported here for existing importers.
 */

import type { KobeBinding, KobeBindingHint } from "./keybindings-table.ts"
import { KobeKeymap } from "./keybindings-table.ts"

export { KobeKeymap } from "./keybindings-table.ts"
export type { KobeBinding, KobeBindingScope } from "./keybindings-table.ts"

/**
 * Pristine `keys`/`prefixKeys`/`hint` captured at module load, BEFORE any
 * override. {@link resetKeymapToDefaults} restores from it, since in-place
 * mutation alone can't "un-override" a row.
 */
const KEYMAP_DEFAULTS: ReadonlyMap<
  string,
  { keys: readonly string[]; prefixKeys?: readonly string[]; hint?: KobeBindingHint }
> = new Map(
  KobeKeymap.map((b) => [
    b.id,
    { keys: [...b.keys], prefixKeys: b.prefixKeys && [...b.prefixKeys], hint: b.hint ? { ...b.hint } : undefined },
  ]),
)

/**
 * From the pristine snapshot, NOT the live row: `RESERVED_GLOBAL_CHORDS`
 * (panes/terminal/keys-pure.ts) derives from this, so a user override never
 * changes which chords the terminal swallows. Unknown id → [].
 */
export function defaultChordsOf(id: string): readonly string[] {
  return KEYMAP_DEFAULTS.get(id)?.keys ?? []
}

/**
 * Called before re-applying the re-read file on live reload, so the result is
 * "defaults + current overrides", never stale pile-up. Mutates in place (rows
 * are runtime-mutable despite `readonly`).
 */
export function resetKeymapToDefaults(): void {
  for (const row of KobeKeymap) {
    const def = KEYMAP_DEFAULTS.get(row.id)
    if (!def) continue
    const mutable = row as { keys: readonly string[]; prefixKeys?: readonly string[]; hint?: KobeBindingHint }
    mutable.keys = [...def.keys]
    mutable.prefixKeys = def.prefixKeys && [...def.prefixKeys]
    mutable.hint = def.hint ? { ...def.hint } : undefined
  }
}

/**
 * Bump-only token incremented on every live reload. Chord LEGENDS need it to
 * re-render because rows mutate in place; dispatch doesn't (it re-reads
 * chords per keypress). React reads it via `useSyncExternalStore(
 * subscribeKeymapVersion, keymapVersion)` (src/tui-react/context/keybindings.ts).
 */
let keymapVersionValue = 0
const keymapVersionListeners = new Set<() => void>()

export function keymapVersion(): number {
  return keymapVersionValue
}

export function subscribeKeymapVersion(listener: () => void): () => void {
  keymapVersionListeners.add(listener)
  return () => {
    keymapVersionListeners.delete(listener)
  }
}

export function bumpKeymapVersion(): void {
  keymapVersionValue += 1
  for (const listener of [...keymapVersionListeners]) listener()
}

/**
 * id → row. Built once: overrides mutate rows but never add/remove/replace
 * them. Keeps `findBinding` O(1) on the per-keypress path (`useBindings`
 * configs call `bindByIds` each dispatch); a linear scan is ~1.4k comparisons
 * per keypress at a realistic 5-group / 23-id stack.
 */
const KEYMAP_BY_ID: ReadonlyMap<string, KobeBinding> = new Map(KobeKeymap.map((b) => [b.id, b]))

export function findBinding(id: string): KobeBinding | undefined {
  return KEYMAP_BY_ID.get(id)
}

export { bindByIds } from "./keybindings-bindings.ts"

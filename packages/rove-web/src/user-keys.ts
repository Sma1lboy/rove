/**
 * The user's `~/.rove/settings/keybindings.yaml` on the Mac, as the TUI's own parser reads it
 * (`keybindings.get`). Rows the file changed are written onto `RoveKeymap` in place, as the
 * TUI's `applyUserKeybindings` does, so every legend that reads the table (F1, the palette,
 * the footer, the HUD) shows the user's chord; the prefix key, its timeout and the plugin
 * chords sit in the store. Defaults are snapshotted before anything is applied.
 */

import { type RoveBinding, RoveKeymap } from "@sma1lboy/rove/src/tui/context/keybindings-table.ts"
import { formatChord } from "@sma1lboy/rove/src/tui/lib/chord-glyphs.ts"
import { useEffect } from "react"
import type { BridgeClient } from "./bridge.ts"
import { createStore, useStore } from "./store.ts"

export interface RowOverride {
  readonly id: string
  readonly keys: readonly string[]
  readonly prefixKeys?: readonly string[]
  readonly hint?: { readonly keys: string }
}

export interface PluginChord {
  readonly chord: string
  readonly kind: "pane" | "action"
  /** `<plugin-id>.<local-id>`. */
  readonly target: string
}

export interface UserKeys {
  readonly path: string
  readonly exists: boolean
  readonly rows: readonly RowOverride[]
  /** `key` null = the command layer is off. */
  readonly prefix: { readonly key: string | null; readonly firstStrokes: readonly string[]; readonly timeoutMs: number }
  readonly plugins: readonly PluginChord[]
  readonly applied: ReadonlyArray<{ id: string; keys: readonly string[]; defaultKeys: readonly string[] }>
  readonly warnings: readonly string[]
}

/** `DEFAULT_PREFIX_CONFIGURATION`. */
export const DEFAULT_USER_KEYS: UserKeys = {
  path: "",
  exists: false,
  rows: [],
  prefix: { key: "ctrl+a", firstStrokes: ["ctrl+a"], timeoutMs: 5000 },
  plugins: [],
  applied: [],
  warnings: [],
}

export const userKeys = createStore<UserKeys>(DEFAULT_USER_KEYS)

type MutableRow = { keys: readonly string[]; prefixKeys?: readonly string[]; hint?: RoveBinding["hint"] }

const DEFAULTS = new Map(
  RoveKeymap.map((row) => [
    row.id,
    { keys: [...row.keys], prefixKeys: row.prefixKeys && [...row.prefixKeys], hint: row.hint && { ...row.hint } },
  ]),
)

/** Defaults back first, then the file's rows: a removed override restores its chord. */
export function setUserKeys(next: UserKeys): void {
  for (const row of RoveKeymap) {
    const def = DEFAULTS.get(row.id)
    if (!def) continue
    const mutable = row as MutableRow
    mutable.keys = [...def.keys]
    mutable.prefixKeys = def.prefixKeys && [...def.prefixKeys]
    mutable.hint = def.hint && { ...def.hint }
  }
  for (const over of next.rows) {
    const row = RoveKeymap.find((candidate) => candidate.id === over.id) as MutableRow | undefined
    if (!row) continue
    row.keys = [...over.keys]
    row.prefixKeys = over.prefixKeys && [...over.prefixKeys]
    row.hint = over.hint && { ...over.hint }
  }
  userKeys.set(next)
}

/** Read the file again; a refusal keeps what was last applied. */
export async function loadUserKeys(client: BridgeClient): Promise<void> {
  try {
    setUserKeys(await client.request<UserKeys>("keybindings.get"))
  } catch {
    // An older bridge has no such op: the defaults stand.
  }
}

/** Read the file once connected, and again whenever this page regains focus: that is the web's live reload. */
export function useUserKeys(client: BridgeClient): void {
  const hello = useStore(client.conn).hello
  useEffect(() => {
    if (!hello) return
    const reload = () => void loadUserKeys(client)
    reload()
    window.addEventListener("focus", reload)
    return () => window.removeEventListener("focus", reload)
  }, [hello, client])
}

/** The first stroke that opens the command layer, or null when the user turned it off. */
export const prefixKey = (): string | null => userKeys.get().prefix.key

/** The prefix key as a keycap string, empty when the layer is off. */
export const prefixCap = (): string => {
  const key = prefixKey()
  return key === null ? "" : formatChord(key)
}

/** What the TUI's hint says for a binding the user may have moved: its first chord, glyphs and all. */
export function chordFor(id: string, kind: "direct" | "prefix" = "direct"): string | undefined {
  const row = RoveKeymap.find((candidate) => candidate.id === id)
  const first = kind === "prefix" ? row?.prefixKeys?.[0] : row?.keys[0]
  return first === undefined ? undefined : formatChord(first)
}

/** The live direct chords of an id (the user's, when the file moved them). */
export const keysOf = (id: string): readonly string[] => RoveKeymap.find((row) => row.id === id)?.keys ?? []

/** A prefix command as the TUI hints it: the prefix keycap, then its first second stroke. */
export function prefixHint(id: string): string {
  const cap = prefixCap()
  const stroke = chordFor(id, "prefix")
  return cap && stroke ? `${cap} ${stroke}` : ""
}

/** The TUI's own second strokes for an id, before any override: what a prefix command binds unless the file says otherwise. */
export const defaultPrefixKeys = (id: string): readonly string[] => DEFAULTS.get(id)?.prefixKeys ?? []

/** The chords the user's file gave this id, when it changed them: `direct` keys or the second `prefix` strokes. */
export function userChordsOf(id: string, kind: "direct" | "prefix"): readonly string[] | undefined {
  const row = userKeys.get().rows.find((candidate) => candidate.id === id)
  const def = DEFAULTS.get(id)
  const mine = kind === "prefix" ? row?.prefixKeys : row?.keys
  const theirs = kind === "prefix" ? def?.prefixKeys : def?.keys
  return mine && JSON.stringify(mine) !== JSON.stringify(theirs ?? []) ? mine : undefined
}

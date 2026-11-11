/**
 * Writes one binding change into the text of `~/.rove/settings/keybindings.yaml`, for the
 * Settings → Keybindings editors (TUI and web bridge). Comments and the user's other entries
 * survive; the result is checked with the same resolver the loader runs, so a chord the loader
 * would drop is refused here instead of saved.
 */

import { type Document, isMap, parseDocument } from "yaml"
import { PREFIX_KEY_ID } from "./chord-recorder"
import { resolveUserKeybindings } from "./keybindings-resolve"
import { DEFAULT_PREFIX_CONFIGURATION, prefixFirstStrokes } from "./keymap-dispatch"
import type { OverridableBinding } from "./keymap-overrides"

export type KeybindingEdit = {
  id: string
  /** `direct` = the binding's own chords; `prefix` = its second stroke after the prefix key. Ignored for `PREFIX_KEY_ID`. */
  mode: "direct" | "prefix"
  /** The chords to bind, `[]` to unbind, or `"default"` to drop the override. */
  keys: readonly string[] | "default"
}

export type KeybindingEditResult = { ok: true; text: string; warnings: string[] } | { ok: false; reasons: string[] }

function platformSections(platform: NodeJS.Platform): string[] {
  if (platform === "darwin") return ["darwin", "macos", "mac"]
  if (platform === "win32") return ["win32", "windows"]
  return [platform]
}

/** Every place the file can set `id` for `mode` on this platform. */
function pathsOf(doc: Document, edit: KeybindingEdit, platform: NodeJS.Platform): string[][] {
  const roots: string[][] = [[], ...platformSections(platform).map((name) => [name])]
  if (edit.id === PREFIX_KEY_ID) return roots.map((root) => [...root, "prefix", "key"])
  const paths: string[][] = []
  for (const root of roots) {
    // A platform section may hold its ids directly, without a `bindings:` level.
    const flat = root.length > 0 && !isMap(doc.getIn([...root, "bindings"]))
    const bindings = flat ? root : [...root, "bindings"]
    const shaped = isMap(doc.getIn([...bindings, edit.id]))
    if (shaped) paths.push([...bindings, edit.id, edit.mode])
    else if (edit.mode === "direct") paths.push([...bindings, edit.id])
    if (edit.mode === "prefix") paths.push([...root, "prefix", "bindings", edit.id])
  }
  return paths
}

function deleteAndPrune(doc: Document, path: string[]): void {
  if (!doc.hasIn(path)) return
  doc.deleteIn(path)
  for (let depth = path.length - 1; depth > 0; depth--) {
    const parent = doc.getIn(path.slice(0, depth))
    if (!isMap(parent) || parent.items.length > 0) return
    doc.deleteIn(path.slice(0, depth))
  }
}

/** A root with nothing in it prints as `{}` or `null`; the file should be its comments alone. */
function printed(doc: Document): string {
  const text = doc.toString()
  const empty = doc.contents === null || (isMap(doc.contents) && doc.contents.items.length === 0)
  return empty ? text.replace(/(\{\}|null)\n$/, "") : text
}

function edited(text: string, edit: KeybindingEdit, platform: NodeJS.Platform): string {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) throw new Error(doc.errors[0]?.message ?? "invalid YAML")
  if (doc.contents !== null && !isMap(doc.contents)) throw new Error("config root must be a YAML mapping")
  const paths = pathsOf(doc, edit, platform)
  // The first path is the base one; a platform entry would win over it, so those go.
  const [base, ...rest] = paths
  for (const path of rest) deleteAndPrune(doc, path)
  if (!base) return printed(doc)
  if (edit.keys === "default") deleteAndPrune(doc, base)
  else if (edit.keys.length === 0) doc.setIn(base, null)
  else if (edit.keys.length === 1) doc.setIn(base, edit.keys[0])
  else {
    const list = doc.createNode([...edit.keys])
    list.flow = true
    doc.setIn(base, list)
  }
  return printed(doc)
}

const sameKeys = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  (a ?? []).length === b.length && b.every((key, i) => a?.[i] === key)

/**
 * `text` with `edit` applied. `keymap` is a throwaway copy of the DEFAULT keymap: the resolver
 * mutates it to show what the new file would do.
 */
export function editKeybindingsYaml(
  text: string,
  edit: KeybindingEdit,
  keymap: readonly OverridableBinding[],
  platform: NodeJS.Platform,
): KeybindingEditResult {
  const isPrefixKey = edit.id === PREFIX_KEY_ID
  const defaults = keymap.find((row) => row.id === edit.id)
  if (!defaults && !isPrefixKey) return { ok: false, reasons: [`${edit.id}: unknown binding id`] }
  const defaultKeys = isPrefixKey
    ? prefixFirstStrokes(DEFAULT_PREFIX_CONFIGURATION)
    : ((edit.mode === "direct" ? defaults?.keys : defaults?.prefixKeys) ?? [])
  const wanted = edit.keys === "default" ? [...defaultKeys] : edit.keys
  let next: string
  try {
    next = edited(text, edit, platform)
  } catch (err) {
    return { ok: false, reasons: [err instanceof Error ? err.message : String(err)] }
  }
  const { report, prefix } = resolveUserKeybindings(
    { path: "", exists: true, doc: parseDocument(next).toJS(), warnings: [] },
    keymap,
    platform,
  )
  const about = report.warnings.filter(
    (w) => w.startsWith(`${edit.id}:`) || w.startsWith(`${edit.id} `) || w.startsWith(`prefix.bindings.${edit.id}`),
  )
  const row = keymap.find((candidate) => candidate.id === edit.id)
  const got = isPrefixKey ? prefixFirstStrokes(prefix) : edit.mode === "direct" ? row?.keys : row?.prefixKeys
  if (!sameKeys(got, wanted)) return { ok: false, reasons: about.length > 0 ? about : [`${edit.id}: not applied`] }
  return { ok: true, text: next, warnings: about }
}

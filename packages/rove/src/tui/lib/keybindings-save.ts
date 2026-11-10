/**
 * Settings → Keybindings saving, shared by the TUI and the web bridge: read the YAML (the starter
 * when there is none), apply `edits`, write it back. All or nothing: a refused edit leaves the
 * file alone. The caller reloads its own keymap.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { readKeybindingsFile, resetKeybindingsFileCache } from "../../state/keybindings-file"
import { defaultKeymapCopy } from "../context/keybindings"
import { KEYBINDINGS_STARTER } from "./keybindings-starter"
import { type KeybindingEdit, editKeybindingsYaml } from "./keybindings-write"

/** `lines` are the refusal reasons, or the loader's warnings about what was saved. */
export type KeybindingSaveResult = { ok: boolean; lines: string[] }

export function writeKeybindingEdits(
  edits: readonly KeybindingEdit[],
  platform: NodeJS.Platform = process.platform,
): KeybindingSaveResult {
  resetKeybindingsFileCache()
  const file = readKeybindingsFile()
  const target = file.source ?? file.path
  const lines: string[] = []
  try {
    let text = file.source ? readFileSync(target, "utf8") : KEYBINDINGS_STARTER
    for (const edit of edits) {
      const result = editKeybindingsYaml(text, edit, defaultKeymapCopy(), platform)
      if (!result.ok) return { ok: false, lines: result.reasons }
      text = result.text
      for (const warning of result.warnings) if (!lines.includes(warning)) lines.push(warning)
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  } catch (err) {
    return { ok: false, lines: [err instanceof Error ? err.message : String(err)] }
  }
  resetKeybindingsFileCache()
  return { ok: true, lines }
}

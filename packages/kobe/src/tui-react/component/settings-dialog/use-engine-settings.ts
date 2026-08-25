/**
 * Engines-section state for the React settings dialog (issue #15, G3) —
 * split out of `./index.tsx` for the file-size cap. Same kv keys and flows
 * as the Solid `src/tui/component/settings-dialog.tsx`: per-vendor launch
 * command + display-name overrides (engineCommand.<id> / engineName.<id>),
 * the customEngineIds registry, and the GLOBAL default engine (the ●
 * marker — only this dialog writes it; per-project picks live in
 * state/vendor-prefs.ts).
 */

import { useEffect, useState } from "react"
import { availableEngineIds } from "../../../engine/account-detect"
import { ENGINE_PROTOCOLS, engineProtocolKey } from "../../../engine/engine-presets"
import { defaultEngineCommand, engineCommandKey, engineNameKey } from "../../../engine/interactive-command"
import { engineEntry } from "../../../engine/registry"
import { getGlobalDefaultVendor, setGlobalDefaultVendor } from "../../../state/vendor-prefs"
import { humanizeSlug } from "../../../tui/component/settings-dialog/model"
import { DEFAULT_TASK_VENDOR, type VendorId } from "../../../types/task"
import { ALL_VENDORS, isBuiltinVendor } from "../../../types/vendor"
import type { KVContext } from "../../context/kv"
import type { DialogContext } from "../../ui/dialog"
import { RenameTaskDialog } from "../rename-task-dialog"

export function useEngineSettings(
  kv: KVContext,
  dialog: DialogContext,
  /** Clamp the body cursor after a custom engine is removed (max = list length incl. the +Add row). */
  onEngineListShrunk: (maxIndex: number) => void,
) {
  // Engines Rove can launch beyond the built-ins + this user's own: the
  // shipped contrib catalog (offered only when its binary is on PATH) and
  // plugin-registered engines. Same source the new-task selector reads, so
  // an engine you can PICK is an engine you can configure here.
  const [detected, setDetected] = useState<readonly VendorId[]>([])
  useEffect(() => {
    void availableEngineIds().then(setDetected)
  }, [])

  function customEngines(): string[] {
    const raw = kv.get("customEngineIds", [])
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : []
  }
  function engineList(): VendorId[] {
    // Built-ins are ALWAYS listed, detected or not — this row is where you
    // point an engine at an off-PATH binary in the first place.
    return [...new Set([...ALL_VENDORS, ...customEngines(), ...detected])]
  }
  /** True only for an engine this user added — the one `x` can unregister. */
  function isCustomEngine(vendor: VendorId): boolean {
    return customEngines().includes(vendor)
  }
  function engineOverride(vendor: VendorId): string {
    const v = kv.get(engineCommandKey(vendor), "")
    return typeof v === "string" ? v.trim() : ""
  }
  function engineCommandText(vendor: VendorId): string {
    return engineOverride(vendor) || defaultEngineCommand(vendor).join(" ")
  }
  function engineIsDefault(vendor: VendorId): boolean {
    // A user-added engine has no built-in default, so it never reads as
    // "(default)"; a contrib/plugin engine does (its catalog command).
    return !isCustomEngine(vendor) && engineOverride(vendor).length === 0 && !engineNameIsCustom(vendor)
  }
  function engineNameOverride(vendor: VendorId): string {
    const v = kv.get(engineNameKey(vendor), "")
    return typeof v === "string" ? v.trim() : ""
  }
  function engineNameIsCustom(vendor: VendorId): boolean {
    return engineNameOverride(vendor).length > 0
  }
  function engineName(vendor: VendorId): string {
    // Built-ins fall back to VENDOR_LABEL; contrib engines to their catalog
    // name; a plain custom engine falls back to its id.
    return engineNameOverride(vendor) || engineEntry(vendor).displayName
  }

  const [defaultEngine, setDefaultEngineState] = useState<VendorId>(
    () => getGlobalDefaultVendor() ?? DEFAULT_TASK_VENDOR,
  )
  function setEngineDefault(vendor: VendorId): void {
    setGlobalDefaultVendor(vendor)
    kv.set("defaultVendor", vendor) // keep the in-process kv consistent
    setDefaultEngineState(vendor)
  }

  async function editEngine(vendor: VendorId): Promise<void> {
    const next = await RenameTaskDialog.show(dialog, engineCommandText(vendor), {
      dialogTitle: `${engineName(vendor)} launch command`,
      fieldLabel: "command",
      submitLabel: "save",
      allowEmpty: true, // blank clears the override → built-in default
    })
    if (next === undefined) return
    kv.set(engineCommandKey(vendor), next.trim())
  }
  async function renameEngine(vendor: VendorId): Promise<void> {
    const next = await RenameTaskDialog.show(dialog, engineName(vendor), {
      dialogTitle: `${engineName(vendor)} display name (blank = default)`,
      fieldLabel: "name",
      submitLabel: "save",
      allowEmpty: true, // blank clears the name override → default label
    })
    if (next === undefined) return
    kv.set(engineNameKey(vendor), next.trim())
  }
  // `x` on an engine row. Built-in → reset its overrides; custom → REMOVE it.
  function resetEngine(vendor: VendorId): void {
    kv.set(engineCommandKey(vendor), "")
    kv.set(engineNameKey(vendor), "")
    if (isCustomEngine(vendor)) {
      // A removed preset must not leave its protocol behind: re-adding the
      // same id later would silently inherit the old declaration.
      kv.set(engineProtocolKey(vendor), "")
      kv.set(
        "customEngineIds",
        customEngines().filter((id) => id !== vendor),
      )
      // Keep the cursor in range after the list shrinks.
      onEngineListShrunk(engineList().length)
    }
  }
  // The "+ Add engine" row: collect id + launch command + protocol + display
  // name and register a new custom engine. Reuses RenameTaskDialog per field.
  async function addEngineFlow(): Promise<void> {
    const idRaw = await RenameTaskDialog.show(dialog, "", {
      dialogTitle: "Add engine",
      fieldLabel: "id",
      submitLabel: "next",
      placeholder: "lowercase slug, e.g. aider",
    })
    if (idRaw === undefined) return
    const id = idRaw.trim().toLowerCase()
    if (!id || isBuiltinVendor(id) || customEngines().includes(id)) return // no blank / shadow / dup
    const command = await RenameTaskDialog.show(dialog, "", {
      dialogTitle: `Add engine · ${id}`,
      fieldLabel: "command",
      submitLabel: "next",
      placeholder: "e.g. aider --model sonnet",
    })
    if (command === undefined) return
    // Declared ONCE, here: a custom engine is a named PRESET, and its
    // protocol is what makes every later `--command <id>` dispatch
    // deterministic instead of sniffed (issue #30). Blank = the generic
    // protocol — the engine still launches, it just gets no transcript
    // reader, trust pre-answer, or engine-specific delivery.
    const protocol = await RenameTaskDialog.show(dialog, "", {
      dialogTitle: `Add engine · ${id} — protocol (blank = none)`,
      fieldLabel: "protocol",
      submitLabel: "next",
      allowEmpty: true,
      placeholder: ENGINE_PROTOCOLS.join(" / "),
    })
    const name = await RenameTaskDialog.show(dialog, id, {
      dialogTitle: `Add engine · ${id}`,
      fieldLabel: "name",
      submitLabel: "add",
      allowEmpty: true, // blank = humanized id
    })
    kv.set("customEngineIds", [...customEngines(), id])
    if (command.trim()) kv.set(engineCommandKey(id), command.trim())
    const declared = protocol?.trim().toLowerCase() ?? ""
    if (declared && ENGINE_PROTOCOLS.includes(declared)) kv.set(engineProtocolKey(id), declared)
    // A typed name wins; otherwise seed a humanized form so the chip reads
    // "My Local Agent", not "my-local-agent".
    const typedName = name?.trim() ?? ""
    kv.set(engineNameKey(id), typedName && typedName !== id ? typedName : humanizeSlug(id))
  }

  return {
    engineList,
    isCustomEngine,
    engineName,
    engineCommandText,
    engineIsDefault,
    defaultEngine,
    setEngineDefault,
    editEngine,
    renameEngine,
    resetEngine,
    addEngineFlow,
  }
}

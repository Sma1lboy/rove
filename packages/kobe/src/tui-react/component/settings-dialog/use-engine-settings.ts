/**
 * Engines-section state for the React settings dialog — one section's state
 * in its own file, like `use-settings-prefs` / `use-section-data`, so
 * `./index.tsx` owns only the dialog's structure. This is the section with
 * real logic behind it: a custom-engine registry and the global default.
 * Per-vendor launch command + display-name overrides
 * (engineCommand.<id> / engineName.<id>),
 * the customEngineIds registry, and the GLOBAL default engine (the ●
 * marker — only this dialog writes it; per-project picks live in
 * state/vendor-prefs.ts).
 */

import { useEffect, useState } from "react"
import { installedEngineIds } from "../../../engine/account-detect"
import { ENGINE_PROTOCOLS, engineProtocolKey } from "../../../engine/engine-presets"
import {
  defaultEngineCommand,
  engineCommandKey,
  engineNameKey,
  humanizeSlug,
} from "../../../engine/interactive-command"
import { engineEntry } from "../../../engine/registry"
import { getGlobalDefaultVendor, setGlobalDefaultVendor } from "../../../state/vendor-prefs"
import { DEFAULT_TASK_VENDOR, type VendorId } from "../../../types/task"
import { ALL_VENDORS, isBuiltinVendor } from "../../../types/vendor"
import type { KVContext } from "../../context/kv"
import { t } from "../../i18n"
import type { DialogContext } from "../../ui/dialog"
import { EngineProtocolPickerDialog } from "../engine-protocol-picker-dialog"
import { RenameTaskDialog } from "../rename-task-dialog"

export function useEngineSettings(
  kv: KVContext,
  dialog: DialogContext,
  /** Clamp the body cursor after a custom engine is removed (max = list length incl. the +Add row). */
  onEngineListShrunk: (maxIndex: number) => void,
) {
  // Engines Rove can launch beyond the built-ins + this user's own: the
  // shipped contrib catalog (offered only when its binary is on PATH) and
  // plugin-registered engines. The INSTALLED list, not the offered one — a
  // switched-off engine still needs its row here to switch back on.
  const [detected, setDetected] = useState<readonly VendorId[]>([])
  useEffect(() => {
    void installedEngineIds().then(setDetected)
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

  function disabledEngines(): string[] {
    const raw = kv.get("disabledEngineIds", [])
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : []
  }
  function isEngineEnabled(vendor: VendorId): boolean {
    return !disabledEngines().includes(vendor)
  }
  /**
   * Switch an engine off (it keeps its overrides, it just stops being offered
   * when picking one for a task) or back on. Switching off the GLOBAL default
   * hands the ● to the first engine still enabled — a default nobody can pick
   * would silently strand every new task; when nothing else is enabled the
   * toggle is refused instead.
   */
  function toggleEngineEnabled(vendor: VendorId): void {
    const off = disabledEngines()
    if (off.includes(vendor)) {
      kv.set(
        "disabledEngineIds",
        off.filter((id) => id !== vendor),
      )
      return
    }
    const nextDefault = engineList().find((id) => id !== vendor && !off.includes(id))
    if (defaultEngine === vendor) {
      if (!nextDefault) return // the last enabled engine stays on
      setEngineDefault(nextDefault)
    }
    kv.set("disabledEngineIds", [...off, vendor])
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
  /**
   * The built-in adapter a custom preset borrows, or `undefined` for the
   * generic one. Read through the kv context rather than
   * `engine-presets.getEngineProtocol` (which reads state.json directly), so
   * a protocol written in this dialog is visible on the row without a
   * reload — the same reason the zen keys are read here and not there.
   */
  function engineProtocol(vendor: VendorId): VendorId | undefined {
    const raw = kv.get(engineProtocolKey(vendor), "")
    const declared = typeof raw === "string" ? raw.trim() : ""
    return declared && ENGINE_PROTOCOLS.includes(declared) ? declared : undefined
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

  /**
   * `d` and the `(●)` radio both land here. Making a switched-off engine the
   * default is a contradiction — the pick would never be offered — so choosing
   * it switches it back on first, which is plainly what the gesture meant.
   */
  function chooseDefaultEngine(vendor: VendorId): void {
    const off = disabledEngines()
    if (off.includes(vendor)) {
      kv.set(
        "disabledEngineIds",
        off.filter((id) => id !== vendor),
      )
    }
    setEngineDefault(vendor)
  }

  async function editEngine(vendor: VendorId): Promise<void> {
    const next = await RenameTaskDialog.show(dialog, engineCommandText(vendor), {
      dialogTitle: t("settings.engines.launchCommandTitle", { name: engineName(vendor) }),
      fieldLabel: t("settings.field.command"),
      submitLabel: t("settings.action.save"),
      allowEmpty: true, // blank clears the override → built-in default
    })
    if (next === undefined) return
    kv.set(engineCommandKey(vendor), next.trim())
  }
  async function renameEngine(vendor: VendorId): Promise<void> {
    const next = await RenameTaskDialog.show(dialog, engineName(vendor), {
      dialogTitle: t("settings.engines.displayNameTitle", { name: engineName(vendor) }),
      fieldLabel: t("settings.field.name"),
      submitLabel: t("settings.action.save"),
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
      // same id later would silently inherit the removed one's declaration.
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
      dialogTitle: t("settings.engines.addTitle"),
      fieldLabel: t("settings.field.id"),
      submitLabel: t("settings.action.next"),
      placeholder: t("settings.engines.idPlaceholder"),
    })
    if (idRaw === undefined) return
    const id = idRaw.trim().toLowerCase()
    if (!id || isBuiltinVendor(id) || customEngines().includes(id)) return // no blank / shadow / dup
    const command = await RenameTaskDialog.show(dialog, "", {
      dialogTitle: t("settings.engines.addStepTitle", { id }),
      fieldLabel: t("settings.field.command"),
      submitLabel: t("settings.action.next"),
      placeholder: t("settings.engines.commandPlaceholder"),
    })
    if (command === undefined) return
    // Declared ONCE, here: a custom engine is a named PRESET, and its
    // protocol is what makes every later `--command <id>` dispatch
    // deterministic instead of sniffed. The generic choice is a ROW in the
    // picker, not a blank field — the engine still launches, it just gets no
    // transcript reader, trust pre-answer, or engine-specific delivery, and
    // that has to be something you picked rather than something you mistyped.
    const protocol = await EngineProtocolPickerDialog.show(dialog, { engineId: id })
    if (protocol === undefined) return
    const name = await RenameTaskDialog.show(dialog, id, {
      dialogTitle: t("settings.engines.addStepTitle", { id }),
      fieldLabel: t("settings.field.name"),
      submitLabel: t("settings.action.add"),
      allowEmpty: true, // blank = humanized id
    })
    kv.set("customEngineIds", [...customEngines(), id])
    if (command.trim()) kv.set(engineCommandKey(id), command.trim())
    // Still validated on the way in: the picker cannot offer a bogus value,
    // but the key it writes is the one every later dispatch trusts.
    if (protocol && ENGINE_PROTOCOLS.includes(protocol)) kv.set(engineProtocolKey(id), protocol)
    // A typed name wins; otherwise seed a humanized form so the chip reads
    // "My Local Agent", not "my-local-agent".
    const typedName = name?.trim() ?? ""
    kv.set(engineNameKey(id), typedName && typedName !== id ? typedName : humanizeSlug(id))
  }

  return {
    engineList,
    isCustomEngine,
    isEngineEnabled,
    toggleEngineEnabled,
    engineName,
    engineProtocol,
    engineCommandText,
    engineIsDefault,
    defaultEngine,
    setEngineDefault,
    chooseDefaultEngine,
    editEngine,
    renameEngine,
    resetEngine,
    addEngineFlow,
  }
}

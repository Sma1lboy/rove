/**
 * Section data the Settings dialog reads from OUTSIDE its own kv state —
 * engine detection probes (fs/env) and the plugin registry (`~/.kobe/
 * plugins.json`). Both are lazy: nothing is read until the owning section
 * is first opened, so a settings open that never visits them pays nothing.
 * Split out of `index.tsx` for the file-size cap, like `use-settings-prefs`
 * / `use-engine-settings`.
 */

import { useEffect, useState } from "react"
import { type EngineStatus, detectEngineStatuses } from "../../../engine/engine-status"
import type { SectionId } from "../../../tui/component/settings-dialog/model"
import type { VendorId } from "../../../types/task"
import { useT } from "../../i18n"
import type { DialogContext } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { RenameTaskDialog } from "../rename-task-dialog"
import { nextEnumValue, normalizeNumberInput, toggledBooleanValue } from "./plugin-settings-core"
import { type PluginRowView, readPluginRows, setPluginEnabled, setPluginSetting } from "./plugins-core"

/**
 * Read-only "installed + logged in" detection for EVERY engine in the
 * Engines section's list — the built-ins with a real account detector and the
 * contrib / plugin / custom engines that only have a binary to probe.
 * `null` while the probe is in flight. Re-probes each time the section is
 * opened (and when the engine list grows), so a CLI installed from another
 * terminal shows up without restarting Rove.
 */
export function useAccountProbes(section: SectionId, vendors: readonly VendorId[]): readonly EngineStatus[] | null {
  const [statuses, setStatuses] = useState<readonly EngineStatus[] | null>(null)
  // `vendors` is rebuilt every render, so the effect keys on its CONTENT
  // (engine ids are slugs — no commas) and re-splits it: depending on the
  // array itself would re-probe on every keystroke in the dialog.
  const key = vendors.join(",")
  useEffect(() => {
    if (section !== "engines") return
    let cancelled = false
    void detectEngineStatuses(key ? key.split(",") : []).then((s) => {
      if (!cancelled) setStatuses(s)
    })
    return () => {
      cancelled = true
    }
  }, [section, key])
  return statuses
}

export interface PluginSettings {
  readonly rows: readonly PluginRowView[]
  /** Flip a plugin's enabled flag; the daemon picks the write up live. */
  readonly toggle: (id: string) => void
  /** Activate one declared setting: cycle an enum, flip a boolean, or prompt. */
  readonly editSetting: (pluginId: string, key: string) => Promise<void>
}

/**
 * Registered plugins, re-read every time the section is opened so an
 * install from another terminal shows up without restarting kobe.
 */
export function usePluginSettings(section: SectionId, dialog: DialogContext): PluginSettings {
  const [rows, setRows] = useState<readonly PluginRowView[]>([])
  const t = useT()
  useEffect(() => {
    if (section !== "plugins") return
    setRows(readPluginRows())
  }, [section])

  /** Every write goes through here: store, then re-read so disk wins. */
  function store(pluginId: string, key: string, value: string): void {
    try {
      setPluginSetting(pluginId, key, value)
    } catch {
      // .env unwritable — the re-read leaves the row showing what disk has.
    }
    setRows(readPluginRows())
  }

  return {
    rows,
    toggle: (id: string) => {
      const row = rows.find((p) => p.id === id)
      if (!row) return
      try {
        setPluginEnabled(id, !row.enabled)
      } catch {
        // Registry unwritable — the re-read below leaves the row as disk has it.
      }
      setRows(readPluginRows())
    },
    editSetting: async (pluginId: string, key: string) => {
      const setting = rows.find((p) => p.id === pluginId)?.settings.find((s) => s.key === key)
      if (!setting) return
      if (setting.type === "enum") {
        store(pluginId, key, nextEnumValue(setting.options, setting.value))
        return
      }
      if (setting.type === "boolean") {
        store(pluginId, key, toggledBooleanValue(setting))
        return
      }
      const next = await RenameTaskDialog.show(dialog, setting.value, {
        // The label is plugin-owned copy, like an action title — shown raw.
        dialogTitle: setting.label,
        fieldLabel: key,
        submitLabel: "save",
        allowEmpty: true,
        placeholder: setting.defaultValue,
      })
      if (next === undefined) return
      if (setting.type !== "number") {
        store(pluginId, key, next.trim())
        return
      }
      const numeric = normalizeNumberInput(next)
      if (numeric === null) {
        await DialogConfirm.show(
          dialog,
          t("settings.plugins.settingInvalidTitle"),
          t("settings.plugins.settingInvalidBody", { label: setting.label }),
          "cancel",
        )
        return
      }
      store(pluginId, key, numeric)
    },
  }
}

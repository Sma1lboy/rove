/**
 * Settings data from OUTSIDE kv (fs/env probes, `~/.rove/plugins.json`),
 * where the slow or failing reads live; `use-settings-prefs` reads kv. All
 * lazy: nothing is read until the owning section is first opened.
 */

import { errorMessage } from "@/lib/error-message"
import { useCallback, useEffect, useRef, useState } from "react"
import { type PluginInstallPreview, preparePluginInstall } from "../../../cli/plugin-install"
import { type MarketEntry, fetchMarketplace } from "../../../cli/plugin-search"
import { type EngineStatus, detectEngineStatuses } from "../../../engine/engine-status"
import { type EngineIntegration, engineIntegrations } from "../../../engine/integration-status"
import { reloadPluginEngines } from "../../../engine/plugin-engines"
import type { SectionId } from "../../../tui/component/settings-dialog/model"
import type { VendorId } from "../../../types/task"
import { useT } from "../../i18n"
import type { DialogContext } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { RenameTaskDialog } from "../rename-task-dialog"
import { type MarketplaceRowView, installedSpecIds, marketplaceRowViews } from "./marketplace-core"
import { nextEnumValue, normalizeNumberInput, toggledBooleanValue } from "./plugin-settings-core"
import { type PluginRowView, readPluginRows, setPluginEnabled, setPluginSetting } from "./plugins-core"

/**
 * "Installed + logged in" detection for EVERY listed engine (binary-only for
 * contrib/plugin/custom). `null` while probing. Re-probes on section open and
 * when the list grows, so a CLI installed elsewhere shows without a restart.
 * Auto routing's tier gate reads the same probe.
 */
export function useAccountProbes(section: SectionId, vendors: readonly VendorId[]): readonly EngineStatus[] | null {
  const [statuses, setStatuses] = useState<readonly EngineStatus[] | null>(null)
  // `vendors` is rebuilt every render: key on its CONTENT (slugs, no commas)
  // or every keystroke re-probes.
  const key = vendors.join(",")
  useEffect(() => {
    if (section !== "engines" && section !== "autoRouting") return
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

/**
 * Which reporting layers each engine has, and whether the one Rove INSTALLS is
 * current (`engine/integration-status.ts`). Separate from
 * {@link useAccountProbes}: this reads what Rove wrote into the engine, and
 * fails independently. `reprobe` shows the install action's effect.
 */
export function useEngineIntegrations(
  section: SectionId,
  vendors: readonly VendorId[],
): { rows: readonly EngineIntegration[] | null; reprobe: () => void } {
  const [rows, setRows] = useState<readonly EngineIntegration[] | null>(null)
  // Content key, as in useAccountProbes.
  const key = vendors.join(",")
  // One reader for both the open effect and `reprobe`.
  const read = useCallback((): void => {
    setRows(engineIntegrations(key ? (key.split(",") as VendorId[]) : []))
  }, [key])
  useEffect(() => {
    if (section !== "engines") return
    read()
  }, [section, read])
  return { rows, reprobe: read }
}

export interface PluginSettings {
  readonly rows: readonly PluginRowView[]
  /** Re-read the registry now — for a writer outside this hook (a Marketplace install). */
  readonly refresh: () => void
  /** Flip a plugin's enabled flag; the daemon picks the write up live. */
  readonly toggle: (id: string) => void
  /** Activate one declared setting: cycle an enum, flip a boolean, or prompt. */
  readonly editSetting: (pluginId: string, key: string) => Promise<void>
}

/** Registered plugins, re-read on every section open. */
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
    refresh: () => setRows(readPluginRows()),
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
      // A secret opens EMPTY, never printing the stored key. Cancel keeps it;
      // submitting empty clears it.
      const initial = setting.type === "secret" ? "" : setting.value
      const next = await RenameTaskDialog.show(dialog, initial, {
        // The label is plugin-owned copy, like an action title — shown raw.
        dialogTitle: setting.label,
        fieldLabel: key,
        submitLabel: t("settings.action.save"),
        allowEmpty: true,
        placeholder: setting.type === "secret" && setting.value !== "" ? "••••••••" : setting.defaultValue,
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

export interface MarketplaceSection {
  readonly rows: readonly MarketplaceRowView[]
  /** The GitHub query is still in flight — no rows yet, and none coming this instant. */
  readonly loading: boolean
  /** GitHub was unreachable; `rows` is the first-party fallback list. */
  readonly offline: boolean
  /** Phase or outcome of the last install attempt; "" when idle. */
  readonly status: string
  /** Preview the install, ask, then run it. Resolves when it has settled. */
  readonly install: (ref: string) => Promise<void>
}

/**
 * Settings → Marketplace: the GitHub topic listing, re-queried on every open
 * (the offline retry path), joined with the registry.
 *
 * Installs in-process: the approved preview and the commands that run must be
 * the same staged checkout, and a detached `rove plugin install --yes` would
 * move approval out of this dialog.
 */
export function useMarketplace(section: SectionId, dialog: DialogContext, plugins: PluginSettings): MarketplaceSection {
  const t = useT()
  const [entries, setEntries] = useState<readonly MarketEntry[] | null>(null)
  const [offline, setOffline] = useState(false)
  const [status, setStatus] = useState("")
  // One install at a time: it owns a staging dir and a confirm dialog.
  const busy = useRef(false)

  useEffect(() => {
    if (section !== "marketplace") return
    let cancelled = false
    setEntries(null)
    void fetchMarketplace().then((result) => {
      if (cancelled) return
      setEntries(result.entries)
      setOffline(result.offline)
    })
    return () => {
      cancelled = true
    }
  }, [section])

  /**
   * Identity, origin, every declared command, parser warnings, trust note.
   * Nothing is sandboxed, so `docs/PLUGIN-AUTHORING.md` requires showing the
   * commands before any runs.
   */
  function previewMessage(preview: PluginInstallPreview): string {
    const lines = [`${preview.name} (${preview.id}) v${preview.version}`]
    if (preview.description) lines.push(preview.description)
    lines.push(t("settings.marketplace.previewSource", { source: preview.source }), "")
    if (preview.commands.length === 0) {
      lines.push(t("settings.marketplace.previewNoCommands"))
    } else {
      lines.push(t("settings.marketplace.previewCommands"))
      // Manifest command lines are plugin-owned text, shown raw.
      for (const command of preview.commands) lines.push(`  ${command}`)
    }
    for (const warning of preview.warnings) lines.push(t("settings.marketplace.previewWarning", { warning }))
    lines.push("", t("settings.marketplace.previewTrust"))
    return lines.join("\n")
  }

  return {
    rows: marketplaceRowViews(entries ?? [], plugins.rows),
    loading: entries === null,
    offline,
    status,
    install: async (ref: string) => {
      if (busy.current) return
      const already = installedSpecIds(plugins.rows).get(ref.toLowerCase())
      if (already) {
        setStatus(t("settings.marketplace.alreadyInstalled", { id: already }))
        return
      }
      busy.current = true
      setStatus(t("settings.marketplace.preparing", { ref }))
      try {
        const prepared = await preparePluginInstall(ref)
        const approved = await DialogConfirm.show(
          dialog,
          t("settings.marketplace.confirmTitle", { name: prepared.preview.name }),
          previewMessage(prepared.preview),
          undefined,
          t("settings.marketplace.confirmInstall"),
          // `danger`: focus starts on Cancel so a stray Enter never runs a stranger's commands.
          { danger: true, size: "medium" },
        )
        if (approved !== true) {
          prepared.discard()
          setStatus(t("settings.marketplace.cancelled"))
          return
        }
        setStatus(t("settings.marketplace.installing", { name: prepared.preview.name }))
        const id = await prepared.commit()
        // Engine contributions are kobe-process state: reload so a new engine
        // reaches the selector without a restart.
        reloadPluginEngines()
        // Flip this row to `installed` now, not on next Plugins open.
        plugins.refresh()
        setStatus(t("settings.marketplace.installed", { id, version: prepared.preview.version }))
      } catch (err) {
        setStatus(t("settings.marketplace.failed", { error: errorMessage(err) }))
      } finally {
        busy.current = false
      }
    },
  }
}

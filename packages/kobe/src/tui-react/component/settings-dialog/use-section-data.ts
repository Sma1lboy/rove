/**
 * Section data the Settings dialog reads from OUTSIDE its own kv state —
 * engine detection probes (fs/env) and the plugin registry (`~/.kobe/
 * plugins.json`). Both are lazy: nothing is read until the owning section
 * is first opened, so a settings open that never visits them pays nothing.
 * The seam is where the data COMES FROM: `use-settings-prefs` reads kv, this
 * reads the filesystem and environment, so the probes that can be slow or fail
 * are all on one side of the line and easy to keep lazy.
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
 * Read-only "installed + logged in" detection for EVERY engine in the
 * Engines section's list — the built-ins with a real account detector and the
 * contrib / plugin / custom engines that only have a binary to probe.
 * `null` while the probe is in flight. Re-probes each time the section is
 * opened (and when the engine list grows), so a CLI installed from another
 * terminal shows up without restarting Rove. The Auto effort section reads
 * the same probe — its gate asks "is this tier's engine logged in", which is
 * this question for a subset of the same list.
 */
export function useAccountProbes(section: SectionId, vendors: readonly VendorId[]): readonly EngineStatus[] | null {
  const [statuses, setStatuses] = useState<readonly EngineStatus[] | null>(null)
  // `vendors` is rebuilt every render, so the effect keys on its CONTENT
  // (engine ids are slugs — no commas) and re-splits it: depending on the
  // array itself would re-probe on every keystroke in the dialog.
  const key = vendors.join(",")
  useEffect(() => {
    if (section !== "engines" && section !== "autoEffort") return
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
 * Which reporting layers each listed engine has, and whether the one Rove
 * INSTALLS is current on this machine (`engine/integration-status.ts`).
 *
 * Separate from {@link useAccountProbes} because the two answer different
 * questions about the same row and fail independently: that one probes the
 * engine's own install and login, this one reads what Rove wrote into the
 * engine. `reprobe` is what makes the install action visible — the whole
 * point of the row is that pressing it changes these states, and a panel
 * that still showed the pre-install reading would be the same blind spot in
 * a new place.
 */
export function useEngineIntegrations(
  section: SectionId,
  vendors: readonly VendorId[],
): { rows: readonly EngineIntegration[] | null; reprobe: () => void } {
  const [rows, setRows] = useState<readonly EngineIntegration[] | null>(null)
  // Same content key as useAccountProbes: `vendors` is a fresh array every
  // render, so depending on it would re-read every engine config on each
  // keystroke in the dialog.
  const key = vendors.join(",")
  // One reader, used by both the section-open effect and `reprobe`, so the
  // install row's re-read runs exactly the code the first read ran.
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
    refresh: () => setRows(readPluginRows()),
    toggle: (id: string) => {
      const row = rows.find((p) => p.id === id)
      if (!row) return
      try {
        // setPluginEnabled also re-reads the TUI's plugin-engine table, so
        // the flip reaches the selector without a restart.
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
      // A secret opens EMPTY rather than pre-filled: the dialog would
      // otherwise print the stored key in full, which is exactly what the
      // masked row exists to prevent. Cancelling still leaves it stored;
      // submitting empty clears it, like any other string row.
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
 * Settings → Marketplace: the GitHub topic listing, re-queried each time the
 * section is opened (which is also how a user retries after an offline
 * result), joined with the registry so an installed plugin is marked rather
 * than offered twice.
 *
 * The install runs in this process because it has to: the preview the user
 * approves and the commands that then run must be the same staged checkout,
 * and handing the spec to a detached `rove plugin install --yes` would move
 * the approval out of the dialog the trust model puts it in.
 */
export function useMarketplace(section: SectionId, dialog: DialogContext, plugins: PluginSettings): MarketplaceSection {
  const t = useT()
  const [entries, setEntries] = useState<readonly MarketEntry[] | null>(null)
  const [offline, setOffline] = useState(false)
  const [status, setStatus] = useState("")
  // An install owns a staging directory and a confirm dialog; a second one
  // started from the same row would race both.
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
   * What the install is about to do, in full: identity, origin, every command
   * the manifest declares, the parser's warnings, and the trust note. This is
   * the gate `docs/PLUGIN-AUTHORING.md` requires — nothing is sandboxed, so
   * the commands are shown before any of them runs.
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
          // `danger`: initial focus lands on Cancel. A stray Enter must never
          // be what runs a stranger's build commands.
          { danger: true, size: "medium" },
        )
        if (approved !== true) {
          prepared.discard()
          setStatus(t("settings.marketplace.cancelled"))
          return
        }
        setStatus(t("settings.marketplace.installing", { name: prepared.preview.name }))
        const id = await prepared.commit()
        // Engine contributions are kobe-process state, so a plugin that adds
        // an engine reaches the selector without a restart — same reason
        // `setPluginEnabled` re-reads the table.
        reloadPluginEngines()
        // Re-read the registry so the row this install came from flips to
        // `installed` now, rather than the next time Plugins is opened.
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

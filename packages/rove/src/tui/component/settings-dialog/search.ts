/**
 * Settings search: every navigable row across the searchable sections, with
 * the words a user would type to find it (its label, the heading it sits
 * under, its inline hint). Pure: callers pass the translators, so vitest can
 * build an index without @opentui.
 */

import type { VendorId } from "../../../types/vendor"
import { LOCALES } from "../../i18n/catalog"
import { PREFIX_KEY_ID } from "../../lib/chord-recorder"
import { type SectionId, type SettingsRow, type SettingsRowsInput, sectionRows } from "./model"

/**
 * Sections whose rows are always present. Plugins and Marketplace load on
 * first visit and Feedback is a form, so their rows are not settings to jump to.
 */
export const SEARCHABLE_SECTIONS: readonly SectionId[] = ["general", "engines", "autoRouting", "keys", "dev"]

export type SettingsSearchDeps = {
  t: (key: string) => string
  /** Keybinding catalog lookup (`keys.desc.<id>`), whose ids carry dots. */
  bindingLabel: (bindingId: string) => string
  engineName: (vendor: VendorId) => string
}

export type SettingsSearchHit = {
  section: SectionId
  /** The row's body index within its section: where a jump puts the cursor. */
  index: number
  row: SettingsRow
  label: string
  /** The heading the row is drawn under; "" when it has none of its own. */
  group: string
  hint: string
}

type Text = { label: string; group?: string; hint?: string }

/** i18n keys for a row: label, then heading, then inline hint. */
const keyed = (label: string, group?: string, hint?: string) => ({ label, group, hint })

const GENERAL = "settings.general"
const STATIC_ROW_KEYS: Partial<Record<SettingsRow["kind"], ReturnType<typeof keyed>>> = {
  toast: keyed(`${GENERAL}.toast`, `${GENERAL}.notifications`, `${GENERAL}.toastHint`),
  sound: keyed(`${GENERAL}.sound`, `${GENERAL}.notifications`, `${GENERAL}.soundHint`),
  soundVolume: keyed("settings.search.soundVolume", `${GENERAL}.notifications`, `${GENERAL}.soundVolumeHint`),
  crossTask: keyed(`${GENERAL}.crossTask`, `${GENERAL}.notifications`, `${GENERAL}.crossTaskHint`),
  finishedAlerts: keyed(`${GENERAL}.finishedAlerts`, `${GENERAL}.notifications`, `${GENERAL}.finishedAlertsHint`),
  keyHints: keyed(`${GENERAL}.keyHintsShow`, `${GENERAL}.keyHints`, `${GENERAL}.keyHintsShowHint`),
  zenDefaultOn: keyed(`${GENERAL}.zenDefaultOn`, `${GENERAL}.zen`, `${GENERAL}.zenHint`),
  updateChannel: keyed(`${GENERAL}.updateChannelTitle`, `${GENERAL}.updates`, `${GENERAL}.updateChannelHint`),
  updateNotify: keyed(`${GENERAL}.updateNotify`, `${GENERAL}.updates`, `${GENERAL}.updateNotifyHint`),
  updateCheck: keyed(`${GENERAL}.updateCheckButton`, `${GENERAL}.updates`, `${GENERAL}.updateCheckHint`),
  editorKind: keyed(`${GENERAL}.editor`, undefined, `${GENERAL}.editorRowHint`),
  editorCustom: keyed("settings.search.editorCustom", `${GENERAL}.editor`),
  worktreeBase: keyed(`${GENERAL}.worktree`, undefined, `${GENERAL}.worktreeBaseHint`),
  worktreeCustom: keyed("settings.search.worktreeCustom", `${GENERAL}.worktree`, `${GENERAL}.worktreeBaseHint`),
  scrollbackRows: keyed("settings.search.scrollbackRows", `${GENERAL}.terminal`, `${GENERAL}.scrollbackRowHint`),
  tabStripHideSingle: keyed("settings.search.tabStrip", `${GENERAL}.terminal`),
  engineAdd: keyed("settings.engines.addTitle"),
  engineHooksInstall: keyed("settings.search.hooksInstall", "settings.engines.integrations.title"),
  engineHooksUninstall: keyed("settings.search.hooksUninstall", "settings.engines.integrations.title"),
  engineSkillInstall: keyed("settings.engines.skill.title", undefined, "settings.engines.skill.hint"),
  autoRoutingClassifier: keyed("settings.autoRouting.classifierLabel", "settings.autoRouting.classifierTitle"),
  autoRoutingClassifierEndpoint: keyed("settings.autoRouting.endpointLabel", "settings.autoRouting.classifierTitle"),
  autoRoutingClassifierThreshold: keyed(
    "settings.autoRouting.thresholdLabel",
    "settings.autoRouting.classifierTitle",
    "settings.autoRouting.thresholdHint",
  ),
  autoRoutingClassifierKey: keyed("settings.autoRouting.keyLabel", "settings.autoRouting.classifierTitle"),
  devReset: keyed("settings.dev.reset", undefined, "settings.dev.resetHint"),
  devRestartDaemon: keyed("settings.dev.restart", undefined, "settings.dev.restartHint"),
  devReloadSettings: keyed("settings.dev.reload", undefined, "settings.dev.reloadHint"),
  devRemoteProjects: keyed("settings.dev.remote", "settings.dev.experimental", "settings.dev.remoteHint"),
  devAutoStatus: keyed("settings.dev.autoStatus", "settings.dev.experimental", "settings.dev.autoStatusHint"),
  devDispatcher: keyed("settings.dev.dispatcher", "settings.dev.experimental", "settings.dev.dispatcherHint"),
}

function rowText(row: SettingsRow, deps: SettingsSearchDeps): Text | null {
  const { t } = deps
  switch (row.kind) {
    case "language":
      return { label: LOCALES.find((l) => l.id === row.locale)?.label ?? row.locale, group: t(`${GENERAL}.language`) }
    case "appearance":
      return { label: t(`${GENERAL}.${row.setting}`), group: t(`${GENERAL}.appearance`) }
    case "engine":
      return { label: deps.engineName(row.vendor) }
    case "autoRoutingTier":
      return { label: t(`tasks.tier.${row.tier}`), group: t("settings.autoRouting.title") }
    case "prefixTapPresentation":
      return {
        label: t(
          row.presentation === "local"
            ? "settings.keybindings.tapPresentationLocal"
            : "settings.keybindings.tapPresentationGuide",
        ),
        group: t("settings.keybindings.tapPresentation"),
      }
    case "keybinding":
      return {
        label: row.bindingId === PREFIX_KEY_ID ? t("settings.keybindings.prefixKey") : deps.bindingLabel(row.bindingId),
      }
  }
  const keys = STATIC_ROW_KEYS[row.kind]
  if (!keys) return null
  return { label: t(keys.label), group: keys.group && t(keys.group), hint: keys.hint && t(keys.hint) }
}

/** Every searchable row, in section order and then drawn order. */
export function settingsSearchIndex(input: SettingsRowsInput, deps: SettingsSearchDeps): SettingsSearchHit[] {
  return SEARCHABLE_SECTIONS.flatMap((section) =>
    sectionRows(section, input).flatMap((row, index): SettingsSearchHit[] => {
      const text = rowText(row, deps)
      if (!text) return []
      const group = text.group && text.group !== text.label ? text.group : ""
      return [{ section, index, row, label: text.label, group, hint: text.hint ?? "" }]
    }),
  )
}

const words = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)
const hasAll = (haystack: string, terms: readonly string[]): boolean => {
  const lower = haystack.toLowerCase()
  return terms.every((term) => lower.includes(term))
}

/**
 * Rows whose label, heading, hint or section name hold every word of `query`.
 * Rows matched on their label alone come first; an empty query matches nothing.
 */
export function searchSettings(
  index: readonly SettingsSearchHit[],
  query: string,
  sectionLabel: (section: SectionId) => string,
): SettingsSearchHit[] {
  const terms = words(query)
  if (terms.length === 0) return []
  const byLabel: SettingsSearchHit[] = []
  const byContext: SettingsSearchHit[] = []
  for (const hit of index) {
    if (hasAll(hit.label, terms)) byLabel.push(hit)
    else if (hasAll(`${hit.label} ${hit.group} ${hit.hint} ${sectionLabel(hit.section)}`, terms)) byContext.push(hit)
  }
  return [...byLabel, ...byContext]
}

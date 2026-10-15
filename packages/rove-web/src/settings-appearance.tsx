/**
 * Settings → General → Appearance: the TUI's twelve appearance settings. Each pick is written to
 * the TUI's own state.json key and shows on this page at once, which is the preview. Two have
 * nothing to draw on a page (transparent background, split-pane style); they are still written so
 * the TUI changes.
 */

import type { BridgeClient } from "./bridge.ts"
import { t } from "./i18n/index.ts"
import { type PrefKey, type Prefs, choicesOf, setPref, usePrefs } from "./prefs.ts"
import { ts } from "./settings-copy.ts"
import { Chips, Group, type Pick, Toggle } from "./settings-rows.tsx"

/** The TUI's wording for one choice of an enum setting (`appearance-labels.ts`). */
const CHOICE_LABEL: Partial<Record<PrefKey, Record<string, string>>> = {
  themeMode: { dark: "appearance.modeDark", light: "appearance.modeLight", auto: "appearance.modeAuto" },
  focusAccent: {
    primary: "general.accentPrimary",
    success: "general.accentSuccess",
    info: "general.accentInfo",
  },
  splitStyle: {
    box: "general.splitBox",
    line: "general.splitLine",
    rail: "general.splitRail",
    rule: "general.splitRule",
  },
  railFold: {
    glyphs: "general.railFoldGlyphs",
    initials: "general.railFoldInitials",
    hairline: "general.railFoldHairline",
  },
  tabRowHeight: { "1": "appearance.singleRow", "2": "appearance.doubleRow" },
  workingBorder: { flow: "appearance.borderFlow", still: "appearance.borderStill" },
  taskColors: { on: "appearance.enabled", off: "appearance.disabled" },
  glyphSet: {
    braille: "appearance.glyphsBraille",
    starburst: "appearance.glyphsStarburst",
    ascii: "appearance.glyphsAscii",
  },
  colorblind: { on: "appearance.enabled", off: "appearance.disabled" },
  runningTitle: { shimmer: "appearance.titleShimmer", still: "appearance.titleStill" },
}

/** Rows in the TUI's order; `hint` is the TUI's own hint key when it has one. */
const ROWS: readonly { key: PrefKey; label: string; hint?: string; terminalOnly?: true }[] = [
  { key: "theme", label: "general.theme" },
  { key: "themeMode", label: "general.themeMode" },
  { key: "transparent", label: "general.transparent", terminalOnly: true },
  { key: "focusAccent", label: "general.focusAccent", hint: "general.focusAccentHint" },
  { key: "splitStyle", label: "general.splitStyle", terminalOnly: true },
  { key: "railFold", label: "general.railFold", hint: "general.railFoldHint" },
  { key: "tabRowHeight", label: "general.tabRowHeight", hint: "general.tabRowHeightHint" },
  { key: "workingBorder", label: "general.workingBorder" },
  { key: "taskColors", label: "general.taskColors" },
  { key: "glyphSet", label: "general.glyphSet" },
  { key: "colorblind", label: "general.colorblind" },
  { key: "runningTitle", label: "general.runningTitle" },
]

export function AppearanceGroup({ client }: { client: BridgeClient }) {
  const state = usePrefs()
  const pick = <K extends PrefKey>(key: K, value: Prefs[K]) => void setPref(client, key, value)
  return (
    <Group title={ts("general.appearance")}>
      {ROWS.map((row) => {
        const hint = [row.hint ? ts(row.hint) : null, row.terminalOnly ? t("prefs.terminalOnly") : null]
          .filter(Boolean)
          .join(" ")
        if (row.key === "transparent") {
          return (
            <Toggle
              key={row.key}
              label={ts(row.label)}
              hint={hint}
              checked={state.prefs.transparent}
              onChange={(next) => pick("transparent", next)}
            />
          )
        }
        const names = CHOICE_LABEL[row.key]
        const picks: Pick<string | number>[] = (
          row.key === "theme" ? state.themes.map((th) => th.name) : choicesOf(state, row.key)
        ).map((value) => ({
          value: value as string | number,
          label:
            row.key === "theme"
              ? String(value)
              : row.key === "themeMode" && value === "auto"
                ? t("prefs.modeAuto")
                : ts(names?.[String(value)] ?? String(value)),
        }))
        return (
          <Chips
            key={row.key}
            label={ts(row.label)}
            hint={hint || undefined}
            value={state.prefs[row.key] as string | number}
            picks={picks}
            onPick={(next) => pick(row.key, next as never)}
          />
        )
      })}
    </Group>
  )
}

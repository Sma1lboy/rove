/**
 * Settings → Appearance: the TUI's appearance settings. Each pick is written to the TUI's own state.json key and
 * shows on this page at once; the theme tiles also preview on hover. Two have nothing to draw on a page
 * (transparent background, split-pane style): they are grouped apart and still written, so the TUI changes.
 */

import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { type PrefKey, type Prefs, choicesOf, setPref, usePrefs } from "./prefs.ts"
import { RAIL_GROUPS, type RailGroup, railGroup, setRailGroup } from "./rail-group.ts"
import { ts } from "./settings-copy.ts"
import { TaskRowsPreview } from "./settings-preview.tsx"
import { Choice, Group, Toggle } from "./settings-rows.tsx"
import { ThemeGallery } from "./settings-theme-gallery.tsx"
import { STATUS_MARKS, type StatusMarkStyle, setStatusMarkStyle, statusMarkStyle } from "./status-mark.ts"
import { useStore } from "./store.ts"
import { useMode } from "./task-colors.ts"

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
  workingBorder: { flow: "appearance.borderFlow", still: "appearance.borderStill" },
  glyphSet: {
    braille: "appearance.glyphsBraille",
    starburst: "appearance.glyphsStarburst",
    ascii: "appearance.glyphsAscii",
  },
  runningTitle: { shimmer: "appearance.titleShimmer", still: "appearance.titleStill" },
}

type EnumKey = keyof typeof CHOICE_LABEL & PrefKey
type FlagKey = "transparent" | "taskColors" | "colorblind"

export function AppearanceSection({ model }: { model: AppModel }) {
  const { client } = model
  const state = usePrefs()
  const mode = useMode()
  const grouping = useStore(railGroup)
  const mark = useStore(statusMarkStyle)
  const pick = <K extends PrefKey>(key: K, value: Prefs[K]) => void setPref(client, key, value)

  const choice = (key: EnumKey, label: string, hint?: string) => (
    <Choice
      label={ts(label)}
      hint={hint}
      value={state.prefs[key] as string}
      picks={choicesOf(state, key).map((value) => ({
        value: value as string,
        label:
          key === "themeMode" && value === "auto"
            ? t("prefs.modeAuto")
            : ts(CHOICE_LABEL[key]?.[String(value)] ?? String(value)),
      }))}
      onPick={(next) => pick(key, next as never)}
    />
  )
  // The on/off prefs the TUI stores as "on" / "off" are switches here.
  const flag = (key: FlagKey, label: string, hint?: string) => (
    <Toggle
      label={ts(label)}
      hint={hint}
      checked={key === "transparent" ? state.prefs.transparent : state.prefs[key] === "on"}
      onChange={(next) => pick(key, (key === "transparent" ? next : next ? "on" : "off") as never)}
    />
  )

  return (
    <>
      <Group>
        <ThemeGallery
          model={model}
          label={ts("general.theme")}
          themes={state.themes}
          value={state.prefs.theme}
          mode={mode}
        />
        {choice("themeMode", "general.themeMode")}
      </Group>
      <Group title={t("settings.appearance.groupColours")}>
        {choice("focusAccent", "general.focusAccent", ts("general.focusAccentHint"))}
        {flag("taskColors", "general.taskColors", t("settings.appearance.taskColorsNote"))}
        {flag("colorblind", "general.colorblind", t("settings.appearance.colorblindNote"))}
      </Group>
      <Group title={t("settings.appearance.groupTasks")} lead={<TaskRowsPreview model={model} />}>
        {choice("workingBorder", "general.workingBorder", t("settings.appearance.workingBorderNote"))}
        {choice("runningTitle", "general.runningTitle")}
        {choice("glyphSet", "general.glyphSet")}
        {choice("railFold", "general.railFold", ts("general.railFoldHint"))}
        <Choice<RailGroup>
          label={t("settings.appearance.railGroup")}
          value={grouping}
          picks={RAIL_GROUPS.map((value) => ({
            value,
            label: t(value === "state" ? "settings.appearance.railGroupState" : "settings.appearance.railGroupProject"),
          }))}
          onPick={setRailGroup}
        />
        <Choice<StatusMarkStyle>
          label={t("settings.appearance.statusMark")}
          hint={t("settings.appearance.statusMarkNote")}
          value={mark}
          picks={STATUS_MARKS.map((value) => ({
            value,
            label: t(
              value === "engine" ? "settings.appearance.statusMarkEngine" : "settings.appearance.statusMarkDots",
            ),
          }))}
          onPick={setStatusMarkStyle}
        />
      </Group>
      <Group title={t("settings.appearance.groupTerminal")} hint={t("prefs.terminalOnly")}>
        {flag("transparent", "general.transparent")}
        {choice("splitStyle", "general.splitStyle")}
      </Group>
    </>
  )
}

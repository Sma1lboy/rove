/**
 * Settings → General: language and the interface, where files and worktrees go, the terminal. Every row
 * reads and writes the TUI's own state.json key through `prefs.set`. Notifications, appearance, updates and
 * the browser's sign-out have their own sections.
 */

import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { type PrefKey, type Prefs, choicesOf, setPref, usePrefs } from "./prefs.ts"
import { ts } from "./settings-copy.ts"
import { Choice, Group, Row, Toggle } from "./settings-rows.tsx"
import { SETTINGS_NUMBER } from "./ui/settings.ts"

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
] as const

const WORKTREE_LABEL = {
  default: "general.worktreeKindDefault",
  nextToProject: "general.worktreeKindNext",
  custom: "general.worktreeKindCustom",
} as const

export function GeneralSection({ model }: { model: AppModel }) {
  const { client } = model
  const state = usePrefs()
  const { prefs, info } = state
  const set = <K extends PrefKey>(key: K, value: Prefs[K]) => void setPref(client, key, value)
  // `custom` is offered once a custom base is remembered, as the TUI's cycle skips it until then.
  const kinds: Prefs["worktreeBase"][] = ["default", "nextToProject"]
  if (info.worktreeCustomPath || prefs.worktreeBase === "custom") kinds.push("custom")
  const worktreeKinds = kinds.map((value) => ({ value, label: ts(WORKTREE_LABEL[value]) }))
  return (
    <>
      <Group title={t("settings.general.groupInterface")}>
        <Choice
          label={ts("general.language")}
          hint={t("prefs.languageHint")}
          value={prefs.locale}
          picks={LANGUAGES}
          onPick={(next) => set("locale", next)}
        />
        <Toggle
          label={ts("general.keyHintsShow")}
          hint={ts("general.keyHintsHint")}
          checked={prefs.keyHints}
          onChange={(next) => set("keyHints", next)}
        />
        <Toggle
          label={ts("general.zenDefaultOn")}
          hint={t("prefs.zenHint")}
          checked={prefs.zen}
          onChange={(next) => set("zen", next)}
        />
        <Choice
          label={t("settings.general.tabStrip")}
          value={prefs.tabStrip}
          picks={(choicesOf(state, "tabStrip") as Prefs["tabStrip"][]).map((value) => ({
            value,
            label: ts(`general.tabStripMode.${value}`),
          }))}
          onPick={(next) => set("tabStrip", next)}
        />
      </Group>
      <Group title={t("settings.general.groupFiles")}>
        <Choice
          label={ts("general.worktree")}
          hint={ts("general.worktreeHint")}
          value={prefs.worktreeBase}
          picks={worktreeKinds}
          onPick={(next) => set("worktreeBase", next)}
        />
      </Group>
      <Group title={t("settings.general.groupTerminal")} hint={ts("general.terminalHint")}>
        <ScrollbackRow client={client} />
      </Group>
    </>
  )
}

/** The scrollback field: a whole number of rows within the TUI's bounds, saved on Enter or blur. */
function ScrollbackRow({ client }: { client: BridgeClient }) {
  const state = usePrefs()
  const range = state.options.scrollbackRows
  const bounds = range && "min" in range ? range : { min: 100, max: 100000 }
  const [draft, setDraft] = useState(String(state.prefs.scrollbackRows))
  useEffect(() => setDraft(String(state.prefs.scrollbackRows)), [state.prefs.scrollbackRows])
  const save = () => {
    const rows = Number(draft)
    if (draft.trim() === "" || !Number.isInteger(rows)) {
      setDraft(String(state.prefs.scrollbackRows))
      return
    }
    // The TUI clamps a number outside its bounds rather than refusing it.
    const clamped = Math.min(bounds.max, Math.max(bounds.min, rows))
    if (clamped !== state.prefs.scrollbackRows) void setPref(client, "scrollbackRows", clamped)
    else setDraft(String(clamped))
  }
  return (
    <Row label={t("settings.general.scrollback")} hint={ts("general.scrollbackRowHint")}>
      <input
        className={SETTINGS_NUMBER}
        inputMode="numeric"
        value={draft}
        aria-label={ts("general.scrollbackTitle")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </Row>
  )
}

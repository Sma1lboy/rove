/**
 * Settings → General, in the TUI's order: language, appearance, notifications, keyboard hints,
 * zen, editor, worktree location, terminal. Every row reads and writes the TUI's own state.json
 * key through `prefs.set`; the daemon notice is the page's own.
 */

import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { t } from "./i18n/index.ts"
import { signOut } from "./login.ts"
import { allowDesktopNotices, chime } from "./notify.ts"
import { type PrefKey, type Prefs, choicesOf, nextChoice, prefsStore, setPref, usePrefs } from "./prefs.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { AppearanceGroup } from "./settings-appearance.tsx"
import { ts } from "./settings-copy.ts"
import { Chips, CycleRow, Group, ReadOnlyRow, Toggle } from "./settings-rows.tsx"
import { buttonClass } from "./ui/button.tsx"
import { PREF_HINT, PREF_LABEL, PREF_NUMBER, PREF_ROW } from "./ui/settings.ts"
import { ACTIONS, INPUT, MONO } from "./ui/text.ts"

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
] as const

const WORKTREE_LABEL = {
  default: "general.worktreeKindDefault",
  nextToProject: "general.worktreeKindNext",
  custom: "general.worktreeKindCustom",
} as const

export function GeneralSection({ client }: { client: BridgeClient }) {
  const state = usePrefs()
  const { prefs, info } = state
  // A cycle row reads the store at press time: two quick presses step twice before React re-renders.
  const latest = () => prefsStore.get().prefs
  const set = <K extends PrefKey>(key: K, value: Prefs[K]) => void setPref(client, key, value)
  type DaemonInfo = { daemonVersion?: string; stale?: boolean }
  const [daemon, setDaemon] = useState<DaemonInfo | null>(() => lastReply<DaemonInfo>(client, "daemon.info") ?? null)
  useEffect(() => {
    void requestRemembered<DaemonInfo>(client, "daemon.info").then(setDaemon, () => setDaemon(null))
  }, [client])

  // TUI cycle: default → next to project → the remembered custom base (skipped when none) → default.
  const nextWorktree = (): Prefs["worktreeBase"] => {
    const current = latest().worktreeBase
    return current === "default"
      ? "nextToProject"
      : current === "nextToProject" && info.worktreeCustomPath
        ? "custom"
        : "default"
  }

  return (
    <>
      <Chips
        label={ts("general.language")}
        hint={t("prefs.languageHint")}
        value={prefs.locale}
        picks={LANGUAGES}
        onPick={(next) => set("locale", next)}
      />
      <AppearanceGroup client={client} />
      <Group title={ts("general.notifications")} hint={ts("general.notificationsHint")}>
        <Toggle label={ts("general.toast")} checked={prefs.toast} onChange={(next) => set("toast", next)} />
        <Toggle
          label={ts("general.sound")}
          hint={t("prefs.soundHint")}
          checked={prefs.sound}
          onChange={(next) => {
            if (next) allowDesktopNotices()
            set("sound", next)
          }}
        />
        <CycleRow
          label={ts("general.soundVolume", { percent: Math.round(prefs.soundVolume * 100) })}
          hint={t("prefs.soundVolumeHint")}
          onCycle={() => {
            const next = nextChoice(choicesOf(state, "soundVolume") as number[], latest().soundVolume)
            // Hearing the next level is how you pick it, as in the TUI.
            if (latest().sound) chime(next)
            set("soundVolume", next)
          }}
        />
        <Toggle
          label={ts("general.crossTask")}
          hint={ts("general.crossTaskHint")}
          checked={prefs.crossTask}
          onChange={(next) => set("crossTask", next)}
        />
      </Group>
      <Group title={ts("general.keyHints")}>
        <Toggle
          label={ts("general.keyHintsShow")}
          hint={ts("general.keyHintsShowHint")}
          checked={prefs.keyHints}
          onChange={(next) => set("keyHints", next)}
        />
      </Group>
      <Group title={ts("general.zen")} hint={t("prefs.zenHint")}>
        <Toggle label={ts("general.zenDefaultOn")} checked={prefs.zen} onChange={(next) => set("zen", next)} />
      </Group>
      <Group title={ts("general.editor")} hint={ts("general.editorHint")}>
        <CycleRow
          label={ts("general.editorRow", { kind: prefs.editorKind })}
          hint={ts("general.editorRowHint")}
          onCycle={() => set("editorKind", nextChoice(choicesOf(state, "editorKind") as string[], latest().editorKind))}
        />
        <ReadOnlyRow
          label={ts("general.editorCustom", {
            cmd: info.editorCustomSet ? t("prefs.editorCustomSet") : ts("general.editorCustomUnset"),
          })}
          note={t("prefs.editInTui")}
        />
      </Group>
      <Group title={ts("general.worktree")} hint={ts("general.worktreeHint")}>
        <CycleRow
          label={ts("general.worktreeBase", { kind: ts(WORKTREE_LABEL[prefs.worktreeBase]) })}
          hint={ts("general.worktreeBaseHint")}
          onCycle={() => set("worktreeBase", nextWorktree())}
        />
        <ReadOnlyRow
          label={ts("general.worktreeCustom", { path: info.worktreeCustomPath || ts("general.worktreeCustomUnset") })}
          note={t("prefs.editInTui")}
        />
      </Group>
      <Group title={ts("general.terminal")} hint={ts("general.terminalHint")}>
        <ScrollbackRow client={client} />
        <CycleRow
          label={ts("general.tabStripRow", { mode: ts(`general.tabStripMode.${prefs.tabStrip}`) })}
          onCycle={() =>
            set("tabStrip", nextChoice(choicesOf(state, "tabStrip") as Prefs["tabStrip"][], latest().tabStrip))
          }
        />
      </Group>
      {daemon?.daemonVersion && (
        <Group title={t("settings.general.daemon")}>
          <p className={`${MONO} ${daemon.stale ? "text-warning" : "text-muted"}`}>
            {t(daemon.stale ? "settings.general.daemonStale" : "settings.general.daemonCurrent", {
              version: daemon.daemonVersion,
            })}
          </p>
        </Group>
      )}
      <Group title={t("settings.general.browser")} hint={t("settings.general.browserHint")}>
        <div className={ACTIONS}>
          <button
            type="button"
            className={buttonClass()}
            onClick={() => void signOut().then(() => window.location.reload())}
          >
            {t("settings.general.signOut")}
          </button>
        </div>
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
    <label className={PREF_ROW}>
      <span className={PREF_LABEL}>{ts("general.scrollbackTitle")}</span>
      <input
        className={`${INPUT} text-ink ${PREF_NUMBER}`}
        inputMode="numeric"
        value={draft}
        aria-label={ts("general.scrollbackField")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <span className={`${PREF_HINT} text-muted`}>{ts("general.scrollbackRowHint")}</span>
    </label>
  )
}

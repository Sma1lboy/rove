/** @jsxImportSource @opentui/react */
/**
 * Two-column Settings PAGE — one full-window surface, mounted once from
 * `workspace/host-pages.tsx`. The pure row registry owns order and payloads;
 * preference hooks own KV reads/writes. j/k navigate, h/l switch levels,
 * Enter activates, and the surrounding dialog stack owns Escape.
 *
 * It used to carry a second, overlay shape behind a `standalone` prop that was
 * only ever passed `true`. The overlay branches were unreachable and would not
 * have worked: cursor-follow registers the page branch's scrollbox, so overlay
 * mode had none at all.
 */

import { errorMessage } from "@/lib/error-message"
import { TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useMemo, useState } from "react"
import { type KobeOrchestrator, RemoteOrchestrator, type UsageSnapshotMap } from "../../../client/remote-orchestrator"
import { createStateCell } from "../../../lib/external-store"
import { submitFeedback } from "../../../lib/feedback"
import {
  type NavLevel,
  SECTIONS,
  type SectionId,
  type SettingsRow,
  rowAt,
  sectionRows,
} from "../../../tui/component/settings-dialog/model"
import { reloadUserKeybindings, userKeybindingsReport } from "../../../tui/context/keybindings-user"
import { createKeybindingsFile } from "../../../tui/lib/keybindings-starter"
import { toggleKeyHints } from "../../../tui/lib/keyboard-hints"
import { LOCALE_KEY } from "../../../tui/lib/persisted-ui-prefs"
import type { VendorId } from "../../../types/task"
import type { KVContext } from "../../context/kv"
import { FOCUS_ACCENT_SLOTS, type FocusAccentSlot, useTheme } from "../../context/theme"
import { type LocaleId, currentLang, setLocaleLang, useT } from "../../i18n"
import { useBindings } from "../../lib/keymap"
import { useAccessor } from "../../lib/use-accessor"
import { useCursorFollow } from "../../lib/use-cursor-follow"
import { type DialogContext, useDialog, useDialogPaddingX } from "../../ui/dialog"
import { confirmResetState, confirmRestartDaemon, hasRestartableDaemon } from "./actions"
import { EngineSettingsSection } from "./sections-engines"
import { GeneralSettingsSection, SettingsSectionSidebar } from "./sections-general"
import { DevSettingsSection, FeedbackSettingsSection, KeybindingsSettingsSection } from "./sections-misc"
import { PluginSettingsSection } from "./sections-plugins"
import { useEngineSettings } from "./use-engine-settings"
import { useAccountProbes, usePluginSettings } from "./use-section-data"
import { useSettingsPrefs } from "./use-settings-prefs"

export type SettingsDialogProps = {
  kv: KVContext
  /** Enables daemon-only Settings actions when present. */
  orchestrator?: KobeOrchestrator
  onClose: () => void
}

/** Stable empty cell for hosts without a daemon connection (hook-order safety). */
const EMPTY_USAGE_SIGNAL = createStateCell<UsageSnapshotMap | null>(null)

export function SettingsDialog(props: SettingsDialogProps) {
  const dialog = useDialog()
  const themeCtx = useTheme()
  const renderer = useRenderer()
  const { theme } = themeCtx
  const t = useT()
  const padX = useDialogPaddingX()
  const [level, setLevel] = useState<NavLevel>("sidebar")
  const [section, setSection] = useState<SectionId>("general")
  const [cursor, setCursor] = useState(0)
  const [bodyRow, setBodyRow] = useState(0)
  const [feedbackTitle, setFeedbackTitle] = useState("")
  const [feedbackBody, setFeedbackBody] = useState("")
  const [feedbackStatus, setFeedbackStatus] = useState("")
  const themeNames = useMemo<readonly string[]>(() => themeCtx.all().slice().sort(), [themeCtx])
  const hasDaemon = hasRestartableDaemon(props.orchestrator)
  const remote = props.orchestrator instanceof RemoteOrchestrator ? props.orchestrator : null
  const prefs = useSettingsPrefs(props.kv, dialog)
  const engines = useEngineSettings(props.kv, dialog, (max) => setBodyRow((r) => Math.max(0, Math.min(r, max))))
  // A local orchestrator has no daemon quota channel and uses the empty cell.
  const usage = useAccessor(remote ? remote.usageSnapshotSignal() : EMPTY_USAGE_SIGNAL)

  // Lazily-probed section data (accounts / plugins) — see ./use-section-data.
  const engineStatuses = useAccountProbes(section, engines.engineList())
  // Writing the starter YAML flips the Keybindings section from "here is an
  // example" to a real file — and re-applying it is what re-renders the
  // section (and drops its create row) without a restart.
  const [keysFileExists, setKeysFileExists] = useState(() => userKeybindingsReport().exists)
  function createKeysFile(): void {
    try {
      createKeybindingsFile(userKeybindingsReport().path)
      reloadUserKeybindings()
    } catch {
      /* unwritable config dir — the section keeps offering the action */
    }
    setKeysFileExists(userKeybindingsReport().exists)
  }
  const plugins = usePluginSettings(section, dialog)

  /**
   * The active section's ordered navigable rows (the row registry).
   * Recomputed per call so kv-driven changes (custom engines) are always
   * fresh in key handlers.
   */
  function bodyRows(): SettingsRow[] {
    return sectionRows(section, {
      themeNames,
      focusAccentSlots: FOCUS_ACCENT_SLOTS,
      engineList: engines.engineList(),
      plugins: plugins.rows.map((p) => ({ id: p.id, settingKeys: p.settings.map((s) => s.key) })),
      hasDaemon,
      keybindingsFileExists: keysFileExists,
    })
  }

  function bodyRowCount(): number {
    return bodyRows().length
  }

  function selectTheme(name: string): void {
    if (themeCtx.selected === name) return
    if (!themeCtx.set(name)) return
    props.kv.set("activeTheme", name)
  }

  // UI language. Live within this process (setLocaleLang updates the module
  // store → useT() consumers re-render) and persisted so other panes pick it
  // up on their next boot, mirroring how the theme is applied + persisted.
  function selectLanguage(locale: LocaleId): void {
    if (currentLang() === locale) return
    setLocaleLang(locale)
    props.kv.set(LOCALE_KEY, locale)
  }

  function toggleTransparent(): void {
    const next = !themeCtx.transparentBackground
    themeCtx.setTransparentBackground(next)
    props.kv.set("transparentBackground", next)
  }

  function selectFocusAccent(slot: FocusAccentSlot): void {
    if (themeCtx.focusAccent === slot) return
    themeCtx.setFocusAccent(slot)
    props.kv.set("focusAccent", slot)
  }

  /** The engine row under the body cursor, or null on the "+ Add engine" row / off-section. */
  function currentEngineRow(): VendorId | null {
    if (section !== "engines" || level !== "body") return null
    const row = rowAt(bodyRows(), bodyRow)
    return row?.kind === "engine" ? row.vendor : null
  }

  async function sendFeedback(): Promise<void> {
    setFeedbackStatus("submitting...")
    try {
      const result = submitFeedback({ title: feedbackTitle, body: feedbackBody })
      setFeedbackStatus(`sent: ${result.url}`)
      setFeedbackTitle("")
      setFeedbackBody("")
      setBodyRow(0)
    } catch (err) {
      setFeedbackStatus(`error: ${errorMessage(err)}`)
    }
  }

  // The Feedback section is an inline form; while it holds focus we suspend
  // this dialog's own j/k/h/l/t nav and drive the form with a dedicated Tab
  // cycle + a Send-row Enter binding below.
  const editingFeedback = section === "feedback" && level === "body"

  function feedbackFieldStep(delta: 1 | -1): void {
    const next = bodyRow + delta
    if (next < 0 || next > 2) {
      setLevel("sidebar")
      return
    }
    setBodyRow(next)
  }

  function enterBody(): void {
    if (level !== "sidebar" || bodyRowCount() === 0) return
    setLevel("body")
    setBodyRow(0)
  }

  function moveCursor(delta: number): void {
    if (level === "sidebar") {
      const next = (cursor + delta + SECTIONS.length) % SECTIONS.length
      setCursor(next)
      const nextSection = SECTIONS[next]
      if (nextSection) {
        setSection(nextSection.id)
        setBodyRow(0)
      }
      return
    }
    const len = bodyRowCount()
    if (len === 0) return
    setBodyRow((bodyRow + delta + len) % len)
  }

  function switchSection(id: SectionId): void {
    setSection(id)
    setCursor(SECTIONS.findIndex((s) => s.id === id))
    setBodyRow(0)
    setLevel("sidebar")
  }

  /**
   * Activation lookup, keyed by row kind. Payload-bearing rows carry their
   * payload in the descriptor, so enter never reverse-engineers it from an
   * index.
   */
  const rowActivators: { [K in SettingsRow["kind"]]: (row: Extract<SettingsRow, { kind: K }>) => void } = {
    theme: (row) => selectTheme(row.name),
    language: (row) => selectLanguage(row.locale),
    transparent: () => toggleTransparent(),
    focusAccent: (row) => selectFocusAccent(row.slot),
    toast: () => prefs.toggleToast(),
    sound: () => prefs.toggleSound(),
    crossTask: () => prefs.toggleCrossTask(),
    keyHints: () => toggleKeyHints(props.kv),
    prefixTapPresentation: (row) => prefs.selectPrefixTapPresentation(row.presentation),
    splitStyle: (row) => prefs.selectSplitStyle(row.style),
    zenDefaultOn: () => prefs.toggleZenDefaultOn(),
    editorKind: () => prefs.cycleEditorKind(),
    editorCustom: () => void prefs.editEditorCustom(),
    worktreeBase: () => prefs.cycleWorktreeBase(),
    worktreeCustom: () => void prefs.editWorktreeCustom(),
    scrollbackRows: () => void prefs.editScrollbackRows(),
    tabStripHideSingle: () => prefs.cycleTabStripMode(),
    engine: (row) => void engines.editEngine(row.vendor),
    engineAdd: () => void engines.addEngineFlow(),
    keysCreate: () => createKeysFile(),
    pluginToggle: (row) => plugins.toggle(row.pluginId),
    pluginSetting: (row) => void plugins.editSetting(row.pluginId, row.key),
    feedbackTitle: () => setBodyRow(0),
    feedbackBody: () => setBodyRow(1),
    feedbackSend: () => void sendFeedback(),
    devReset: () => void confirmResetState(dialog, props.kv, renderer),
    devRestartDaemon: () => void confirmRestartDaemon(dialog, props.orchestrator, renderer),
    devRemoteProjects: () => prefs.toggleRemoteProjects(),
    devAutoStatus: () => prefs.toggleAutoStatus(),
    devDispatcher: () => prefs.toggleDispatcher(),
  }

  function activateBodyRow(): void {
    const row = rowAt(bodyRows(), bodyRow)
    if (!row) return
    ;(rowActivators[row.kind] as (row: SettingsRow) => void)(row)
  }

  useBindings(() => ({
    // Suspend our navigation keys while a sub-dialog (the engine-command /
    // custom-editor text input) is open so `l`/`j`/`k`/`h` reach the input
    // instead of being eaten here.
    enabled: dialog.stack.length === 0 && !editingFeedback,
    bindings: [
      { key: "down", cmd: () => moveCursor(1) },
      { key: "up", cmd: () => moveCursor(-1) },
      { key: "j", cmd: () => moveCursor(1) },
      { key: "k", cmd: () => moveCursor(-1) },
      { key: "tab", cmd: () => moveCursor(1) },
      { key: "right", cmd: enterBody },
      { key: "l", cmd: enterBody },
      { key: "left", cmd: () => setLevel("sidebar") },
      { key: "h", cmd: () => setLevel("sidebar") },
      {
        key: "return",
        cmd: () => {
          if (level === "sidebar") {
            enterBody()
            return
          }
          activateBodyRow()
        },
      },
      {
        // Engines section only: `r` renames the focused engine's display
        // label, `x` resets a built-in (or removes a custom) engine.
        key: "r",
        cmd: () => {
          const v = currentEngineRow()
          if (v) void engines.renameEngine(v)
        },
      },
      {
        key: "x",
        cmd: () => {
          const v = currentEngineRow()
          if (v) engines.resetEngine(v)
        },
      },
      {
        // Engines section: `d` sets the focused engine as the global default.
        key: "d",
        cmd: () => {
          const v = currentEngineRow()
          if (v) engines.chooseDefaultEngine(v)
        },
      },
      {
        // Engines section: `space` switches the focused engine on or off.
        // PROPOSED chord — surfaced for sign-off, see docs/KEYBINDINGS.md.
        key: "space",
        cmd: () => {
          const v = currentEngineRow()
          if (v) engines.toggleEngineEnabled(v)
        },
      },
    ],
  }))

  // Feedback-form navigation, live only while that form holds focus —
  // Tab/Shift+Tab step the fields so typed letters reach the inputs.
  useBindings(() => ({
    enabled: editingFeedback,
    bindings: [
      { key: "tab", cmd: () => feedbackFieldStep(1) },
      { key: "shift+tab", cmd: () => feedbackFieldStep(-1) },
    ],
  }))
  useBindings(() => ({
    enabled: editingFeedback && bodyRow === 2,
    bindings: [{ key: "return", cmd: () => void sendFeedback() }],
  }))

  // Cursor-follow: the page scrollbox registers here and every navigable row
  // registers by its body index, so keyboard navigation never lands on a row
  // clipped below the fold in a short terminal. `-1` while the sidebar holds
  // the cursor: no body row is selected, so nothing is scrolled to.
  const follow = useCursorFollow(level === "body" ? bodyRow : -1)

  const cursorProps = { level, bodyRow, setLevel, setBodyRow, rowRef: follow.rowRef }
  const navHint = (
    <box paddingTop={0}>
      <text fg={theme.textMuted}>{editingFeedback ? t("settings.nav.feedback") : t("settings.nav.default")}</text>
    </box>
  )
  const body = (
    <box paddingLeft={padX} paddingRight={padX} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {t("settings.title")}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.onClose()}>
          {t("settings.esc")}
        </text>
      </box>
      <box flexDirection="row" gap={2}>
        <SettingsSectionSidebar level={level} cursor={cursor} switchSection={switchSection} />
        <box flexGrow={1} flexShrink={1} flexDirection="column" gap={1}>
          {section === "general" ? (
            <GeneralSettingsSection
              {...cursorProps}
              prefs={prefs}
              themeNames={themeNames}
              selectTheme={selectTheme}
              currentLocale={currentLang()}
              selectLanguage={selectLanguage}
              toggleTransparent={toggleTransparent}
              selectFocusAccent={selectFocusAccent}
              usage={usage}
            />
          ) : null}
          {section === "engines" ? (
            <EngineSettingsSection
              {...cursorProps}
              vendors={engines.engineList()}
              statuses={engineStatuses}
              isCustom={engines.isCustomEngine}
              engineProtocol={engines.engineProtocol}
              isEnabled={engines.isEngineEnabled}
              toggleEngine={engines.toggleEngineEnabled}
              chooseDefault={engines.chooseDefaultEngine}
              displayName={engines.engineName}
              commandText={engines.engineCommandText}
              isDefault={engines.engineIsDefault}
              isDefaultEngine={(v) => engines.defaultEngine === v}
              editEngine={(v) => void engines.editEngine(v)}
              onAddEngine={() => void engines.addEngineFlow()}
            />
          ) : null}
          {section === "plugins" ? (
            <PluginSettingsSection
              {...cursorProps}
              plugins={plugins.rows}
              toggle={plugins.toggle}
              editSetting={(id, key) => void plugins.editSetting(id, key)}
            />
          ) : null}
          {section === "keys" ? (
            <KeybindingsSettingsSection {...cursorProps} prefs={prefs} onCreateFile={createKeysFile} />
          ) : null}
          {section === "feedback" ? (
            <FeedbackSettingsSection
              {...cursorProps}
              title={feedbackTitle}
              setTitle={(v) => {
                setFeedbackTitle(v)
                setFeedbackStatus("")
              }}
              body={feedbackBody}
              setBody={(v) => {
                setFeedbackBody(v)
                setFeedbackStatus("")
              }}
              status={feedbackStatus}
              onTitleSubmit={() => setBodyRow(1)}
              submit={() => void sendFeedback()}
            />
          ) : null}
          {section === "dev" ? (
            <DevSettingsSection
              {...cursorProps}
              prefs={prefs}
              hasDaemon={hasDaemon}
              confirmReset={() => void confirmResetState(dialog, props.kv, renderer)}
              confirmRestartDaemon={() => void confirmRestartDaemon(dialog, props.orchestrator, renderer)}
            />
          ) : null}
        </box>
      </box>
    </box>
  )

  return (
    <box flexDirection="column" flexGrow={1}>
      <scrollbox
        ref={follow.scrollRef}
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        verticalScrollbarOptions={{ trackOptions: { foregroundColor: "transparent" } }}
      >
        {body}
      </scrollbox>
      {/* Floating footer: the page content scrolls, this line does not —
          the nav hint is exactly what you want when a long section has
          scrolled its own header out of sight. */}
      <box paddingLeft={padX} paddingRight={padX}>
        {navHint}
      </box>
    </box>
  )
}

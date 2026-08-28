/** @jsxImportSource @opentui/react */
/**
 * Settings sections (issue #15 G3) — Feedback + Dev + Keybindings.
 * Feedback-form design notes: the body is an UNCONTROLLED `<textarea>` so
 * pasted newlines survive; edits mirror back through `onContentChange`,
 * and an external reset clears the edit buffer through the ref.
 */

import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"
import { tildify } from "../../../lib/path-home"
import { stripNewlines } from "../../../tui/component/new-task-dialog/state"
import {
  devRows,
  keybindingRows,
  prefixTapPresentationRowId,
  rowIndex,
} from "../../../tui/component/settings-dialog/model"
import { userKeybindingsReport } from "../../../tui/context/keybindings-user"
import { currentPrefixConfiguration } from "../../../tui/lib/keymap-dispatch"
import { FIXED_BINDING_IDS } from "../../../tui/lib/keymap-overrides"
import { PREFIX_TAP_PRESENTATIONS } from "../../../tui/lib/prefix-tap-presentation"
import { useKeymapVersion } from "../../context/keybindings"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { Row, type SectionCursorProps, SubSection } from "./rows"
import type { SettingsPrefs } from "./use-settings-prefs"

export function FeedbackSettingsSection(
  props: SectionCursorProps & {
    title: string
    setTitle: (v: string) => void
    body: string
    setBody: (v: string) => void
    status: string
    onTitleSubmit: () => void
    submit: () => void
  },
) {
  const { theme } = useTheme()
  const t = useT()
  const editing = props.level === "body"
  const titleFocused = editing && props.bodyRow === 0
  const bodyFocused = editing && props.bodyRow === 1
  const sendFocused = editing && props.bodyRow === 2
  const labelFg = (focused: boolean) => (focused ? theme.primary : theme.textMuted)
  const labelAttrs = (focused: boolean) => (focused ? TextAttributes.BOLD | TextAttributes.UNDERLINE : undefined)

  // The body is an uncontrolled <textarea>, so an external reset (the
  // parent clears `feedbackBody` after a successful send) won't empty the
  // widget on its own. Clear the edit buffer when the value goes blank
  // while the widget still holds text; the resulting onContentChange sets
  // the value to "" too, so the guard makes this a one-shot (no loop).
  const bodyEl = useRef<TextareaRenderable | null>(null)
  useEffect(() => {
    if (props.body === "" && bodyEl.current && bodyEl.current.plainText !== "") {
      bodyEl.current.setText("")
    }
  }, [props.body])

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {t("settings.feedback.title")}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {t("settings.feedback.hint")}
      </text>
      <box flexDirection="column" gap={1}>
        <box gap={0}>
          <text fg={labelFg(titleFocused)} attributes={labelAttrs(titleFocused)}>
            {t("settings.feedback.titleLabel")}
          </text>
          <input
            value={props.title}
            placeholder={t("settings.feedback.titlePlaceholder")}
            focused={titleFocused}
            onMouseUp={() => {
              props.setLevel("body")
              props.setBodyRow(0)
            }}
            onInput={(v: string) => props.setTitle(stripNewlines(v))}
            onSubmit={() => props.onTitleSubmit()}
          />
        </box>
        <box gap={0}>
          <text fg={labelFg(bodyFocused)} attributes={labelAttrs(bodyFocused)}>
            {t("settings.feedback.descriptionLabel")}
          </text>
          <textarea
            ref={(el: TextareaRenderable | null) => {
              bodyEl.current = el
            }}
            initialValue={props.body}
            placeholder={t("settings.feedback.descriptionPlaceholder")}
            focused={bodyFocused}
            height={4}
            wrapMode="word"
            onMouseUp={() => {
              props.setLevel("body")
              props.setBodyRow(1)
            }}
            onContentChange={() => props.setBody(bodyEl.current?.plainText ?? "")}
          />
        </box>
        <box
          flexDirection="row"
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={sendFocused ? theme.primary : theme.backgroundElement}
          onMouseUp={() => {
            props.setLevel("body")
            props.setBodyRow(2)
            props.submit()
          }}
        >
          <text fg={sendFocused ? theme.selectedListItemText : theme.accent} attributes={TextAttributes.BOLD}>
            {t("settings.feedback.send")}
          </text>
        </box>
      </box>
      {props.status ? (
        <text fg={props.status.startsWith("error:") ? theme.warning : theme.success} wrapMode="word">
          {props.status}
        </text>
      ) : null}
    </box>
  )
}

export function DevSettingsSection(
  props: SectionCursorProps & {
    prefs: SettingsPrefs
    hasDaemon: boolean
    confirmReset: () => void
    confirmRestartDaemon: () => void
  },
) {
  const { prefs } = props
  const { theme } = useTheme()
  const t = useT()
  const rows = devRows(props.hasDaemon)
  const isBodyCursor = (row: number) => props.level === "body" && props.bodyRow === row
  const activate = (row: number, action: () => void) => () => {
    props.setLevel("body")
    props.setBodyRow(row)
    action()
  }
  // `[x] Label` — the checkbox column is the state, so the label doesn't
  // repeat it, and a column of switches stays scannable down the block. The
  // top padding is what separates one experiment from the previous one's prose.
  const toggleRow = (id: string, enabled: boolean, hintKey: string, labelKey: string, act: () => void) => {
    const row = rowIndex(rows, id)
    return (
      // Wrapped (not a fragment) so the gap lands BETWEEN experiments — each
      // one is prose + its switch, and previously they ran together into a
      // wall where the switches were invisible.
      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={theme.textMuted} wrapMode="word">
          {t(hintKey)}
        </text>
        <Row
          cursor={isBodyCursor(row)}
          onMouseUp={activate(row, act)}
          fg={theme.text}
          bold={enabled}
          idleBackground={theme.backgroundElement}
        >
          {`${enabled ? "[x]" : "[ ]"} ${t(labelKey)}`}
        </Row>
      </box>
    )
  }
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {t("settings.dev.reset")}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {t("settings.dev.resetHint")}
      </text>
      <Row
        cursor={isBodyCursor(0)}
        onMouseUp={activate(0, props.confirmReset)}
        fg={theme.warning}
        bold={true}
        idleBackground={theme.backgroundElement}
      >
        {t("settings.dev.resetButton")}
      </Row>
      {props.hasDaemon ? (
        <SubSection title={t("settings.dev.restart")} hint={t("settings.dev.restartHint")}>
          <Row
            cursor={isBodyCursor(1)}
            onMouseUp={activate(1, props.confirmRestartDaemon)}
            fg={theme.accent}
            bold={true}
            idleBackground={theme.backgroundElement}
          >
            {t("settings.dev.restartButton")}
          </Row>
        </SubSection>
      ) : null}
      <text fg={theme.textMuted} wrapMode="word">
        {t("settings.dev.doctorHint")}
      </text>

      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {t("settings.dev.experimental")}
        </text>
        {toggleRow(
          "remote-projects",
          prefs.remoteProjectsEnabled(),
          "settings.dev.remoteHint",
          "settings.dev.remote",
          prefs.toggleRemoteProjects,
        )}
        {toggleRow(
          "auto-status",
          prefs.autoStatusOn(),
          "settings.dev.autoStatusHint",
          "settings.dev.autoStatus",
          prefs.toggleAutoStatus,
        )}
        {toggleRow(
          "dispatcher",
          prefs.dispatcherOn(),
          "settings.dev.dispatcherHint",
          "settings.dev.dispatcher",
          prefs.toggleDispatcher,
        )}
        {toggleRow(
          "archived-history",
          prefs.archivedHistoryOn(),
          "settings.dev.archivedHistoryHint",
          "settings.dev.archivedHistory",
          prefs.toggleArchivedHistory,
        )}
      </box>
    </box>
  )
}

/**
 * Keybindings section — read-only view of the user keybinding overrides
 * loaded at boot from `~/.rove/settings/keybindings.yaml`. Editing happens
 * in the YAML file, not here; the section's job is to make the config
 * discoverable, show which overrides actually landed, and surface every
 * load warning that otherwise only reaches the pane's console log.
 */
export function KeybindingsSettingsSection(
  props: SectionCursorProps & {
    /** Write the starter YAML — offered only while the file is absent. */
    onCreateFile: () => void
    prefs: SettingsPrefs
  },
) {
  const { theme } = useTheme()
  const t = useT()
  // Re-read the cached report when the daemon's keybindings channel triggers
  // the host's live keymap reload, so an already-open Settings page stays
  // truthful after a YAML edit.
  useKeymapVersion()
  const report = userKeybindingsReport()
  const rows = keybindingRows(report.exists)
  const prefix = currentPrefixConfiguration()
  const fixedIds = Object.keys(FIXED_BINDING_IDS).sort()
  const appliedIdWidth = Math.min(
    28,
    report.applied.reduce((max, o) => Math.max(max, o.id.length), 0),
  )
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {t("settings.keybindings.title")}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {t("settings.keybindings.hint")}
      </text>
      <box flexDirection="column" gap={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {t("settings.keybindings.configFile")}
        </text>
        {/* Tildified: the raw path wrapped onto a second line, which read as
            two facts instead of one. */}
        <text fg={theme.textMuted} wrapMode="word">
          {tildify(report.path) + (report.exists ? "" : t("settings.keybindings.notCreated"))}
        </text>
      </box>
      <box flexDirection="column" gap={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {t("settings.keybindings.tapPresentation")}
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          {t("settings.keybindings.tapPresentationHint")}
        </text>
        {PREFIX_TAP_PRESENTATIONS.map((presentation) => {
          const row = rowIndex(rows, prefixTapPresentationRowId(presentation))
          const selected = props.prefs.prefixTapPresentation() === presentation
          return (
            <Row
              key={presentation}
              cursor={props.level === "body" && props.bodyRow === row}
              onMouseUp={() => {
                props.setLevel("body")
                props.setBodyRow(row)
                props.prefs.selectPrefixTapPresentation(presentation)
              }}
              fg={selected ? theme.accent : theme.text}
              bold={selected || (props.level === "body" && props.bodyRow === row)}
            >
              {`${selected ? "(●)" : "( )"} ${t(
                presentation === "local"
                  ? "settings.keybindings.tapPresentationLocal"
                  : "settings.keybindings.tapPresentationGuide",
              )}`}
            </Row>
          )
        })}
      </box>
      <box flexDirection="column" gap={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {t("settings.keybindings.prefixTitle", { prefix: prefix.key ?? t("settings.keybindings.prefixDisabled") })}
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          {t("settings.keybindings.prefixHint", {
            prefix: prefix.key ?? t("settings.keybindings.prefixDisabled"),
            timeout: prefix.timeoutMs,
          })}
        </text>
      </box>
      {!report.exists ? (
        // The example used to be printed here for the user to retype into a
        // file they also had to create. It is now the CONTENT of that file,
        // one keypress away — see `keybindings-starter.ts`.
        <box flexDirection="column" gap={0}>
          <text fg={theme.textMuted} wrapMode="word">
            {t("settings.keybindings.createHint")}
          </text>
          <Row
            cursor={props.level === "body" && props.bodyRow === rowIndex(rows, "keys-create")}
            onMouseUp={() => {
              props.setLevel("body")
              props.setBodyRow(rowIndex(rows, "keys-create"))
              props.onCreateFile()
            }}
            fg={theme.text}
            idleBackground={theme.backgroundElement}
          >
            {t("settings.keybindings.createFile")}
          </Row>
        </box>
      ) : (
        <box flexDirection="column" gap={0}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {t("settings.keybindings.overridesApplied")}
          </text>
          {report.applied.length === 0 ? <text fg={theme.textMuted}>{t("settings.keybindings.none")}</text> : null}
          {/* Ids share a column so the chords line up under each other — an
              override list is read by scanning the right-hand side. */}
          {report.applied.map((o) => (
            <text key={o.id} fg={theme.text} wrapMode="none">
              {`${o.id.padEnd(appliedIdWidth)}  ${o.keys.length > 0 ? o.keys.join(" / ") : t("settings.keybindings.unbound")}` +
                `  (${t("settings.keybindings.defaultKeys", { keys: o.defaultKeys.join(" / ") })})`}
            </text>
          ))}
        </box>
      )}
      {report.warnings.length > 0 ? (
        <box flexDirection="column" gap={0}>
          <text fg={theme.warning} attributes={TextAttributes.BOLD}>
            {t("settings.keybindings.warnings")}
          </text>
          {report.warnings.map((w) => (
            <text key={w} fg={theme.warning} wrapMode="word">
              {`! ${w}`}
            </text>
          ))}
        </box>
      ) : null}
      {fixedIds.length > 0 ? (
        <text fg={theme.textMuted} wrapMode="word">
          {t("settings.keybindings.fixed", { ids: fixedIds.join(", ") })}
        </text>
      ) : null}
    </box>
  )
}

/** @jsxImportSource @opentui/react */
/**
 * Settings sections — Feedback + Dev.
 * Feedback-form design notes: the body is an UNCONTROLLED `<textarea>` so
 * pasted newlines survive; edits mirror back through `onContentChange`,
 * and an external reset clears the edit buffer through the ref.
 */

import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"
import { stripNewlines } from "../../../tui/component/new-task-dialog/state"
import { devRows, rowIndex } from "../../../tui/component/settings-dialog/model"
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
    statusWarn: boolean
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

  // Uncontrolled textarea: an external reset (parent clears `feedbackBody`
  // after send) must clear the buffer here. The resulting onContentChange also
  // sets "", so the guard makes this one-shot.
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
        <text fg={props.statusWarn ? theme.warning : theme.success} wrapMode="word">
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
    reloadSettings: () => void
    reloadStatus: string
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
  // `[x] Label`: the checkbox is the state, so the label doesn't repeat it.
  const toggleRow = (id: string, enabled: boolean, hintKey: string, labelKey: string, act: () => void) => {
    const row = rowIndex(rows, id)
    return (
      // A box, not a fragment, so paddingTop separates experiments; without it
      // prose and switches run into one wall.
      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={theme.textMuted} wrapMode="word">
          {t(hintKey)}
        </text>
        <Row
          cursor={isBodyCursor(row)}
          rowRef={props.rowRef(row)}
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
        rowRef={props.rowRef(0)}
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
            rowRef={props.rowRef(1)}
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
      <SubSection title={t("settings.dev.reload")} hint={t("settings.dev.reloadHint")}>
        <Row
          cursor={isBodyCursor(rowIndex(rows, "dev-reload"))}
          rowRef={props.rowRef(rowIndex(rows, "dev-reload"))}
          onMouseUp={activate(rowIndex(rows, "dev-reload"), props.reloadSettings)}
          fg={theme.accent}
          bold={true}
          idleBackground={theme.backgroundElement}
        >
          {t("settings.dev.reloadButton")}
        </Row>
        {props.reloadStatus ? (
          <text fg={theme.textMuted} wrapMode="word">
            {props.reloadStatus}
          </text>
        ) : null}
      </SubSection>

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
      </box>
    </box>
  )
}

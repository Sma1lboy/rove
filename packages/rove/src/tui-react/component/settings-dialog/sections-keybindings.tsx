/** @jsxImportSource @opentui/react */
/**
 * Settings → Keybindings: every rebindable binding as a row. `enter` records a new chord,
 * `backspace` restores the default, `x` unbinds; each change is saved to
 * `~/.rove/settings/keybindings.yaml` and applies at once. Load warnings sit above the list, where
 * they show without scrolling past it.
 */

import { TextAttributes } from "@opentui/core"
import { tildify } from "../../../lib/path-home"
import {
  keybindingRowId,
  keybindingRows,
  prefixTapPresentationRowId,
  rowIndex,
} from "../../../tui/component/settings-dialog/model"
import { findBinding } from "../../../tui/context/keybindings"
import { userKeybindingsReport } from "../../../tui/context/keybindings-user"
import { tKeys } from "../../../tui/i18n"
import { PREFIX_KEY_ID } from "../../../tui/lib/chord-recorder"
import { editableBindings } from "../../../tui/lib/editable-bindings"
import { groupBindings } from "../../../tui/lib/help-groups"
import {
  DEFAULT_PREFIX_CONFIGURATION,
  currentPrefixConfiguration,
  prefixFirstStrokes,
} from "../../../tui/lib/keymap-dispatch"
import { recordSlotLabels } from "../../../tui/lib/keymap-overrides"
import { PREFIX_TAP_PRESENTATIONS } from "../../../tui/lib/prefix-tap-presentation"
import { useKeymapVersion } from "../../context/keybindings"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { Row, type SectionCursorProps } from "./rows"
import type { KeybindingEditor } from "./use-keybinding-editor"
import type { SettingsPrefs } from "./use-settings-prefs"

const DESCRIPTION_WIDTH = 52
const clip = (text: string): string =>
  text.length > DESCRIPTION_WIDTH ? `${text.slice(0, DESCRIPTION_WIDTH - 1)}…` : text

export function KeybindingsSettingsSection(
  props: SectionCursorProps & {
    editor: KeybindingEditor
    prefs: SettingsPrefs
  },
) {
  const { theme } = useTheme()
  const t = useT()
  // Re-read on live keymap reload so an open page stays truthful after a YAML edit.
  useKeymapVersion()
  const report = userKeybindingsReport()
  const rows = keybindingRows()
  const prefix = currentPrefixConfiguration()
  const prefixName = prefix.key ?? t("settings.keybindings.prefixDisabled")
  const { recording, notice } = props.editor
  const select = (row: number, run: () => void) => () => {
    props.setLevel("body")
    props.setBodyRow(row)
    run()
  }

  const withPrefix = (strokes: readonly string[] = []) => strokes.map((stroke) => `${prefixName} ${stroke}`)
  const recordingText = (id: string): string => {
    if (recording?.prefixArmed) return t("settings.keybindings.recordingPrefix", { prefix: prefixName })
    const label = recordSlotLabels(id)[recording?.got.length ?? 0]
    return label ? t("settings.keybindings.recordingSlot", { slot: label }) : t("settings.keybindings.recording")
  }

  /** One editable row: what it does, its live chords (or the recording prompt), and the default once changed. */
  const keyRow = (id: string, label: string, chords: readonly string[], changedFrom: readonly string[] | null) => {
    const row = rowIndex(rows, keybindingRowId(id))
    const isRecording = recording?.id === id
    return (
      <box key={id} flexDirection="column" gap={0}>
        <Row
          cursor={props.level === "body" && props.bodyRow === row}
          rowRef={props.rowRef(row)}
          onMouseUp={select(row, () => props.editor.record(id))}
          fg={changedFrom ? theme.accent : theme.text}
          hint={
            changedFrom && !isRecording
              ? t("settings.keybindings.defaultKeys", { keys: changedFrom.join(" / ") })
              : undefined
          }
        >
          {`${clip(label).padEnd(DESCRIPTION_WIDTH)}  ${
            isRecording ? recordingText(id) : chords.length > 0 ? chords.join(" / ") : t("settings.keybindings.unbound")
          }`}
        </Row>
        {notice?.id === id
          ? notice.lines.map((line) => (
              <text key={line} fg={theme.warning} wrapMode="word">
                {`  ! ${line}`}
              </text>
            ))
          : null}
      </box>
    )
  }
  const defaultPrefix = prefixFirstStrokes(DEFAULT_PREFIX_CONFIGURATION)
  const livePrefix = prefixFirstStrokes(prefix)

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
              rowRef={props.rowRef(row)}
              onMouseUp={select(row, () => props.prefs.selectPrefixTapPresentation(presentation))}
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
          {t("settings.keybindings.prefixTitle", { prefix: prefixName })}
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          {t("settings.keybindings.prefixHint", { prefix: prefixName, timeout: prefix.timeoutMs })}
        </text>
        {keyRow(
          PREFIX_KEY_ID,
          t("settings.keybindings.prefixKey"),
          livePrefix,
          livePrefix.join() === defaultPrefix.join() ? null : defaultPrefix,
        )}
      </box>
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
      {groupBindings(editableBindings()).map((group) => (
        <box key={group.category} flexDirection="column" gap={0}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {tKeys("category", group.category)}
          </text>
          {group.rows.map((binding) => {
            const defaults = [...binding.keys, ...withPrefix(binding.prefixKeys)]
            const live = findBinding(binding.id)
            const chords = [...(live?.keys ?? []), ...withPrefix(live?.prefixKeys)]
            const changed = report.applied.some((o) => o.id === binding.id)
            return keyRow(binding.id, tKeys("desc", binding.id), chords, changed ? defaults : null)
          })}
        </box>
      ))}
    </box>
  )
}

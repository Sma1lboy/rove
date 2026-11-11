/**
 * Settings → Keybindings' editing (TUI `KeybindingsSettingsSection`). A binding's chords are
 * keycaps: pressing one records the next key press as the new chord (the prefix key first makes
 * it a prefix stroke; a paired binding asks for each key), and its `×` (shown on hover, or right after recording) removes them. The Mac
 * writes the YAML (`keybindings.set`) and refuses a chord its loader would drop.
 */

import { PREFIX_KEY_ID, type Recording, recordStroke } from "@sma1lboy/rove/src/tui/lib/chord-recorder.ts"
import { editableBindings } from "@sma1lboy/rove/src/tui/lib/editable-bindings.ts"
import { groupBindings } from "@sma1lboy/rove/src/tui/lib/help-groups.ts"
import { recordSlotLabels } from "@sma1lboy/rove/src/tui/lib/keymap-overrides.ts"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { chordCandidates } from "./chord.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { actionDesc, categoryName } from "./keymap-text.ts"
import { ts } from "./settings-copy.ts"
import { Group, Row } from "./settings-rows.tsx"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { Keycap } from "./ui/keycap.tsx"
import { type UserKeys, loadUserKeys, userKeys } from "./user-keys.ts"

const GROUPS = groupBindings(editableBindings())

type Keys = readonly string[] | "default"
type Change = { direct?: Keys; prefix?: Keys }

export interface BindingEditor {
  /** The binding waiting for a key, if any. */
  readonly recording: Recording | null
  /** What the last save of a binding came to: the loader's reasons or warnings. */
  readonly notice: { id: string; lines: readonly string[] } | null
  record(id: string): void
  save(id: string, change: Change): void
}

export function useBindingEditor(client: BridgeClient): BindingEditor {
  const [recording, setRecording] = useState<Recording | null>(null)
  const [notice, setNotice] = useState<BindingEditor["notice"]>(null)
  const live = useRef(recording)
  live.current = recording

  const save = async (id: string, change: Change) => {
    try {
      const saved = await client.request<{ lines: string[] }>("keybindings.set", { id, ...change })
      setNotice({ id, lines: saved.lines })
      await loadUserKeys(client)
    } catch (err) {
      toast(errorText(err), "error")
    }
  }
  const saveNow = useRef(save)
  saveNow.current = save

  const active = recording !== null
  useEffect(() => {
    if (!active) return
    // Capture phase, and nothing after it: the key being recorded must not also close Settings or run a command.
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      const now = live.current
      if (!now || ["Control", "Shift", "Alt", "Meta"].includes(e.key)) return
      // The prefix key's own cap records a first stroke: the current one must not arm the recorder.
      const prefixStrokes = now.id === PREFIX_KEY_ID ? [] : userKeys.get().prefix.firstStrokes
      const step = recordStroke(now, chordCandidates(e), prefixStrokes)
      if (step.kind === "more") return setRecording(step.recording)
      setRecording(null)
      if (step.kind === "done") void saveNow.current(now.id, { [step.mode]: step.keys })
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [active])

  return {
    recording,
    notice,
    record: (id) => {
      setNotice(null)
      setRecording({ id, slots: Math.max(1, recordSlotLabels(id).length), got: [], prefixArmed: false })
    },
    save: (id, change) => void save(id, change),
  }
}

/** What the cap says while it waits: which key it wants next. */
function prompt(now: Recording, prefixName: string): string {
  if (now.prefixArmed) return ts("keybindings.recordingPrefix", { prefix: prefixName })
  const slot = recordSlotLabels(now.id)[now.got.length]
  return slot ? ts("keybindings.recordingSlot", { slot }) : ts("keybindings.recording")
}

/**
 * The keycaps of one binding: its direct chords in one cap, its prefix stroke in another, or one
 * empty cap when nothing is bound. `changed` paints them as the user's own.
 */
export function BindingCaps(props: {
  editor: BindingEditor
  id: string
  name: string
  direct: readonly string[]
  prefix?: readonly string[]
  prefixName: string
  changed: boolean
}) {
  const { editor, id } = props
  const record = () => editor.record(id)
  const label = t("keys.recordFor", { name: props.name })
  if (editor.recording?.id === id) {
    return (
      <Keycap tone="active" label={label} onPress={record}>
        {prompt(editor.recording, props.prefixName)}
      </Keycap>
    )
  }
  const tone = props.changed ? "changed" : "idle"
  const justSaved = editor.notice?.id === id
  const prefix = props.prefix ?? []
  if (props.direct.length === 0 && prefix.length === 0) {
    return (
      <Keycap tone="empty" label={label} onPress={record}>
        {ts("keybindings.unbound")}
      </Keycap>
    )
  }
  return (
    <>
      {props.direct.length > 0 && (
        <Keycap
          tone={tone}
          label={label}
          onPress={record}
          onRemove={() => editor.save(id, { direct: [] })}
          removeLabel={t("keys.removeFor", { name: props.name })}
          removeShown={justSaved}
        >
          {props.direct.join(" / ")}
        </Keycap>
      )}
      {prefix.length > 0 && (
        <Keycap
          tone={tone}
          label={label}
          onPress={record}
          onRemove={() => editor.save(id, { prefix: [] })}
          removeLabel={t("keys.removeFor", { name: props.name })}
          removeShown={justSaved}
        >
          {prefix.map((stroke) => `${props.prefixName} ${stroke}`).join(" / ")}
        </Keycap>
      )}
    </>
  )
}

/** Under a binding's name: the loader's word on the last save, else the default with a way back to it. */
export function bindingHint(editor: BindingEditor, id: string, defaults: string | null, fallback?: string): ReactNode {
  const lines = editor.notice?.id === id ? editor.notice.lines : []
  if (lines.length > 0) return <span className="text-warning">{lines.join(" ")}</span>
  if (defaults === null) return fallback
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      {ts("keybindings.defaultKeys", { keys: defaults })}
      <Button hit="tight" onClick={() => editor.save(id, { direct: "default", prefix: "default" })}>
        {t("keys.reset")}
      </Button>
    </span>
  )
}

/** Every rebindable binding, grouped as F1 groups them. */
export function BindingRows({ editor, keys }: { editor: BindingEditor; keys: UserKeys }) {
  const prefixName = keys.prefix.key ?? ts("keybindings.prefixDisabled")
  const spelled = (direct: readonly string[], prefix: readonly string[] = []) =>
    [...direct, ...prefix.map((stroke) => `${prefixName} ${stroke}`)].join(" / ")
  return (
    <>
      {GROUPS.map((group) => (
        <Group key={group.category} title={categoryName(group.category)}>
          {group.rows.map((binding) => {
            const mine = keys.rows.find((candidate) => candidate.id === binding.id)
            const name = actionDesc(binding.id)
            return (
              <Row
                key={binding.id}
                label={name}
                hint={bindingHint(editor, binding.id, mine ? spelled(binding.keys, binding.prefixKeys) : null)}
              >
                <BindingCaps
                  editor={editor}
                  id={binding.id}
                  name={name}
                  direct={mine?.keys ?? binding.keys}
                  prefix={mine ? mine.prefixKeys : binding.prefixKeys}
                  prefixName={prefixName}
                  changed={mine !== undefined}
                />
              </Row>
            )
          })}
        </Group>
      ))}
    </>
  )
}

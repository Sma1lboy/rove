/**
 * Settings → Keybindings' binding rows (TUI `KeybindingsSettingsSection`): Record takes the next
 * key press as the binding's chord (the prefix key first makes it a prefix stroke; a paired
 * binding asks for each key), Default drops the override, Unbind clears it. The Mac writes the
 * YAML (`keybindings.set`) and refuses a chord its loader would drop.
 */

import { type Recording, recordStroke } from "@sma1lboy/rove/src/tui/lib/chord-recorder.ts"
import { editableBindings } from "@sma1lboy/rove/src/tui/lib/editable-bindings.ts"
import { groupBindings } from "@sma1lboy/rove/src/tui/lib/help-groups.ts"
import { recordSlotLabels } from "@sma1lboy/rove/src/tui/lib/keymap-overrides.ts"
import { useEffect, useRef, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { chordCandidates } from "./chord.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { actionDesc, categoryName } from "./keymap-text.ts"
import { ts } from "./settings-copy.ts"
import { Group, Row } from "./settings-rows.tsx"
import { useStore } from "./store.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { loadUserKeys, userKeys } from "./user-keys.ts"

const BINDINGS = editableBindings()
const GROUPS = groupBindings(BINDINGS)

type Change = { direct?: readonly string[] | "default"; prefix?: readonly string[] | "default" }

export function BindingsEditor({ client }: { client: BridgeClient }) {
  const keys = useStore(userKeys)
  const [recording, setRecording] = useState<Recording | null>(null)
  const [notice, setNotice] = useState<{ id: string; lines: readonly string[] } | null>(null)
  const live = useRef(recording)
  live.current = recording
  const prefixName = keys.prefix.key ?? ts("keybindings.prefixDisabled")
  const withPrefix = (strokes: readonly string[] = []) => strokes.map((stroke) => `${prefixName} ${stroke}`)

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
      const step = recordStroke(now, chordCandidates(e), userKeys.get().prefix.firstStrokes)
      if (step.kind === "more") return setRecording(step.recording)
      setRecording(null)
      if (step.kind === "done") void saveNow.current(now.id, { [step.mode]: step.keys })
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [active])

  const prompt = (now: Recording): string => {
    if (now.prefixArmed) return ts("keybindings.recordingPrefix", { prefix: prefixName })
    const slot = recordSlotLabels(now.id)[now.got.length]
    return slot ? ts("keybindings.recordingSlot", { slot }) : ts("keybindings.recording")
  }

  return (
    <>
      {GROUPS.map((group) => (
        <Group key={group.category} title={categoryName(group.category)}>
          {group.rows.map((binding) => {
            const row = keys.rows.find((candidate) => candidate.id === binding.id)
            const chords = [...(row?.keys ?? binding.keys), ...withPrefix(row ? row.prefixKeys : binding.prefixKeys)]
            const defaults = [...binding.keys, ...withPrefix(binding.prefixKeys)]
            const mine = recording?.id === binding.id ? recording : null
            const lines = notice?.id === binding.id ? notice.lines : []
            return (
              <Row
                key={binding.id}
                label={actionDesc(binding.id)}
                hint={
                  lines.length > 0 ? (
                    <span className="text-warning">{lines.join(" ")}</span>
                  ) : row ? (
                    ts("keybindings.defaultKeys", { keys: defaults.join(" / ") })
                  ) : undefined
                }
              >
                <span className={row ? "font-mono text-accent" : "font-mono"}>
                  {mine ? prompt(mine) : chords.length > 0 ? chords.join(" / ") : ts("keybindings.unbound")}
                </span>
                <Button
                  variant="action"
                  onClick={() => {
                    setNotice(null)
                    setRecording({
                      id: binding.id,
                      slots: Math.max(1, recordSlotLabels(binding.id).length),
                      got: [],
                      prefixArmed: false,
                    })
                  }}
                >
                  {t("keys.record")}
                </Button>
                {row && (
                  <Button
                    variant="action"
                    onClick={() => void save(binding.id, { direct: "default", prefix: "default" })}
                  >
                    {t("keys.default")}
                  </Button>
                )}
                {chords.length > 0 && (
                  <Button
                    variant="action"
                    onClick={() =>
                      void save(binding.id, {
                        ...((row?.keys ?? binding.keys).length > 0 ? { direct: [] } : {}),
                        ...((row ? row.prefixKeys : binding.prefixKeys)?.length ? { prefix: [] } : {}),
                      })
                    }
                  >
                    {t("keys.unbind")}
                  </Button>
                )}
              </Row>
            )
          })}
        </Group>
      ))}
    </>
  )
}

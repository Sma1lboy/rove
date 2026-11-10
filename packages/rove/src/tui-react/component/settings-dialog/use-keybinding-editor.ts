/**
 * Settings → Keybindings editing: record a new chord for a binding, restore its default, or
 * unbind it. Every change goes through `saveKeybindingEdits`, which writes the YAML and reloads.
 */

import { useEffect, useRef, useState } from "react"
import { findBinding } from "../../../tui/context/keybindings"
import {
  reloadUserKeybindings,
  saveKeybindingEdits,
  userKeybindingsReport,
} from "../../../tui/context/keybindings-user"
import { type Recording, recordStroke } from "../../../tui/lib/chord-recorder"
import { createKeybindingsFile } from "../../../tui/lib/keybindings-starter"
import type { KeybindingEdit } from "../../../tui/lib/keybindings-write"
import { prefixFirstStrokes } from "../../../tui/lib/keymap-dispatch"
import { matchKey } from "../../../tui/lib/keymap-match"
import { recordSlotLabels } from "../../../tui/lib/keymap-overrides"
import { captureKeys } from "../../lib/keymap"

/** What the last edit of a binding came to: why it was refused, or what the loader warns about it. */
export type KeybindingNotice = { id: string; ok: boolean; lines: readonly string[] }

/** `onFileCreated` runs when a save wrote the first file: the section drops its create row, so the rows below move up one. */
export function useKeybindingEditor(onFileCreated: () => void) {
  const [recording, setRecording] = useState<Recording | null>(null)
  const [notice, setNotice] = useState<KeybindingNotice | null>(null)
  const [fileExists, setFileExists] = useState(() => userKeybindingsReport().exists)
  const release = useRef<(() => void) | null>(null)
  useEffect(() => () => release.current?.(), [])

  function save(id: string, edits: readonly KeybindingEdit[]): void {
    const had = userKeybindingsReport().exists
    setNotice({ id, ...saveKeybindingEdits(edits) })
    const has = userKeybindingsReport().exists
    setFileExists(has)
    if (!had && has) onFileCreated()
  }

  function stop(): void {
    release.current?.()
    release.current = null
    setRecording(null)
  }

  return {
    recording,
    notice,
    fileExists,
    /** Write the commented starter file; the section then drops its create row. */
    createFile(): void {
      try {
        createKeybindingsFile(userKeybindingsReport().path)
        reloadUserKeybindings()
      } catch {
        /* unwritable config dir — the section keeps offering the action */
      }
      setFileExists(userKeybindingsReport().exists)
    },
    /** The next keypress (or presses) becomes the binding; escape cancels. */
    record(id: string): void {
      stop()
      let current: Recording = { id, slots: Math.max(1, recordSlotLabels(id).length), got: [], prefixArmed: false }
      setRecording(current)
      setNotice(null)
      release.current = captureKeys((evt) => {
        const step = recordStroke(current, matchKey(evt), prefixFirstStrokes())
        if (step.kind === "more") {
          current = step.recording
          setRecording(current)
          return
        }
        stop()
        if (step.kind === "done") save(id, [{ id, mode: step.mode, keys: step.keys }])
      })
    },
    reset(id: string): void {
      save(id, [
        { id, mode: "direct", keys: "default" },
        { id, mode: "prefix", keys: "default" },
      ])
    },
    unbind(id: string): void {
      const row = findBinding(id)
      const edits: KeybindingEdit[] = []
      if (row && row.keys.length > 0) edits.push({ id, mode: "direct", keys: [] })
      if (row?.prefixKeys && row.prefixKeys.length > 0) edits.push({ id, mode: "prefix", keys: [] })
      if (edits.length > 0) save(id, edits)
    },
  }
}

export type KeybindingEditor = ReturnType<typeof useKeybindingEditor>

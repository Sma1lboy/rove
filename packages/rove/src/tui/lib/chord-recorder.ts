/** One binding being recorded in Settings → Keybindings: the strokes so far and what the next one means. */

/** The `id` of the row that rebinds the prefix key itself (`prefix.key`), not a keymap binding. */
export const PREFIX_KEY_ID = "prefix.key"

export type Recording = {
  id: string
  /** Direct chords to collect before the recording is done. */
  slots: number
  got: readonly string[]
  /** The prefix key was pressed first: the next stroke is this binding's prefix stroke. */
  prefixArmed: boolean
}

export type RecordStep =
  | { kind: "more"; recording: Recording }
  | { kind: "cancel" }
  | { kind: "done"; mode: "direct" | "prefix"; keys: string[] }

/**
 * Feed one keypress (its `matchKey` candidates). You press what you will press later: the prefix
 * key and then a stroke records a prefix binding, anything else a direct chord. Escape cancels.
 */
export function recordStroke(
  recording: Recording,
  candidates: readonly string[],
  prefixStrokes: readonly string[],
): RecordStep {
  const chord = candidates.find((c) => c === "enter" || c.endsWith("+enter")) ?? candidates[0]
  if (chord === undefined) return { kind: "more", recording }
  if (candidates.includes("escape")) return { kind: "cancel" }
  if (recording.prefixArmed) return { kind: "done", mode: "prefix", keys: [chord] }
  if (recording.got.length === 0 && prefixStrokes.some((key) => candidates.includes(key))) {
    return { kind: "more", recording: { ...recording, prefixArmed: true } }
  }
  const got = [...recording.got, chord]
  if (got.length < recording.slots) return { kind: "more", recording: { ...recording, got } }
  return { kind: "done", mode: "direct", keys: got }
}

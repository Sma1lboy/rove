/**
 * Quick-task composer bindings, pure so vitest can pin the gating.
 *
 * A matched binding consumes its keypress (`dispatchKeyEvent` calls
 * `preventDefault()`), so field-dependent chords are gated at REGISTRATION:
 * `return` / `left` / `right` exist ONLY while a chip row is focused. On the
 * text fields Enter reaches the input's `onSubmit` and ←/→ move its cursor.
 */

import type { Binding } from "../lib/keymap"

export type QuickTaskField = "prompt" | "attempts" | "engine" | "branch"

export interface QuickTaskBindingHandlers {
  cycleField: (dir: 1 | -1) => void
  stepAttempts: (dir: 1 | -1) => void
  stepEngine: (dir: 1 | -1) => void
  commit: () => void
  /** ctrl+v: read the OS clipboard for an image/file attachment. */
  pasteAttachment: () => void
  /** ctrl+x: drop the most recently added attachment. */
  removeLastAttachment: () => void
}

export function quickTaskBindings(field: QuickTaskField, h: QuickTaskBindingHandlers): Binding[] {
  return [
    { key: "tab", cmd: () => h.cycleField(1) },
    { key: "shift+tab", cmd: () => h.cycleField(-1) },
    { key: "ctrl+e", cmd: () => h.stepEngine(1) },
    // Field-independent: text paste arrives as a bracketed PasteEvent, so
    // raw ctrl+v steals nothing — and it's the only route to a clipboard IMAGE.
    { key: "ctrl+v", cmd: () => h.pasteAttachment() },
    { key: "ctrl+x", cmd: () => h.removeLastAttachment() },
    // Chip rows have no input cursor or onSubmit, so they claim ←/→ and enter.
    ...(field === "attempts"
      ? [
          { key: "left", cmd: () => h.stepAttempts(-1) },
          { key: "right", cmd: () => h.stepAttempts(1) },
          { key: "return", cmd: () => h.commit() },
        ]
      : []),
    ...(field === "engine"
      ? [
          { key: "left", cmd: () => h.stepEngine(-1) },
          { key: "right", cmd: () => h.stepEngine(1) },
          { key: "return", cmd: () => h.commit() },
        ]
      : []),
  ]
}

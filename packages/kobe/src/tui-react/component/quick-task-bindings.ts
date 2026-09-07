/**
 * Pure binding builder for the quick-task composer — extracted from
 * `quick-task-composer.tsx` so the field-gating contract is
 * vitest-testable (the component file drags in `@opentui`).
 *
 * THE contract, and what "type a prompt, hit enter" depends on: a
 * matched binding consumes its keypress — `dispatchKeyEvent` calls
 * `preventDefault()` on every hit, so the focused input never sees the
 * key. Field-dependent chords therefore must be gated at REGISTRATION:
 * `return` / `left` / `right` exist in the returned list ONLY while the
 * engine chip row is focused. On the prompt/branch fields they're
 * absent, so Enter falls through to the input's own `onSubmit` (commit)
 * and ←/→ move the input cursor.
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
    // Attachment chords are field-independent: text paste arrives as a
    // bracketed PasteEvent (never as ctrl+v), so claiming the raw ctrl+v
    // keypress steals nothing from the inputs — it's the only way to
    // reach a clipboard IMAGE, which the terminal can't deliver as text.
    { key: "ctrl+v", cmd: () => h.pasteAttachment() },
    { key: "ctrl+x", cmd: () => h.removeLastAttachment() },
    // Both chip rows claim ←/→ and enter for the same reason: a chip row has
    // no input to move a cursor in or to fire onSubmit. The gating stays at
    // REGISTRATION (see the header) so the text fields keep both.
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

import type { KeyEvent } from "@opentui/core"
import { type CtrlModifierKeyName, isCtrlModifierKeyName } from "./modifier-keys"

export const CTRL_HOLD_THRESHOLD_MS = 400

type CtrlHoldState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending"; readonly timer: ReturnType<typeof setTimeout> }
  | { readonly kind: "visible" }

export type CtrlHoldDetector = Readonly<{
  keypress: (event: Pick<KeyEvent, "name" | "eventType">) => void
  keyrelease: (event: Pick<KeyEvent, "name" | "eventType">) => void
  cancel: () => void
}>

export function createCtrlHoldDetector(callbacks: {
  readonly onReveal: () => void
  readonly onHide: () => void
}): CtrlHoldDetector {
  let state: CtrlHoldState = { kind: "idle" }
  const held = new Set<CtrlModifierKeyName>()

  const reset = (): void => {
    if (state.kind === "pending") clearTimeout(state.timer)
    if (state.kind === "visible") callbacks.onHide()
    state = { kind: "idle" }
  }

  const cancel = (): void => {
    reset()
    held.clear()
  }

  const keypress = (event: Pick<KeyEvent, "name" | "eventType">): void => {
    if (!isCtrlModifierKeyName(event.name)) {
      cancel()
      return
    }
    if (event.eventType === "repeat" && held.has(event.name)) return
    if (event.eventType !== "press") return

    held.add(event.name)
    if (state.kind !== "idle") return

    const timer = setTimeout(() => {
      state = { kind: "visible" }
      callbacks.onReveal()
    }, CTRL_HOLD_THRESHOLD_MS)
    state = { kind: "pending", timer }
  }

  const keyrelease = (event: Pick<KeyEvent, "name" | "eventType">): void => {
    if (!isCtrlModifierKeyName(event.name) || event.eventType !== "release") return
    held.delete(event.name)
    if (held.size === 0) reset()
  }

  return { keypress, keyrelease, cancel }
}

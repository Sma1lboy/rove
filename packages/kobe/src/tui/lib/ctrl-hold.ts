import type { KeyEvent } from "@opentui/core"
import { type CtrlModifierKeyName, isCtrlModifierKeyName } from "./modifier-keys"

export const CTRL_HOLD_THRESHOLD_MS = 400

type CtrlHoldState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending"; readonly key: CtrlModifierKeyName; readonly timer: ReturnType<typeof setTimeout> }
  | { readonly kind: "visible"; readonly key: CtrlModifierKeyName }

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

  const cancel = (): void => {
    if (state.kind === "pending") clearTimeout(state.timer)
    if (state.kind === "visible") callbacks.onHide()
    state = { kind: "idle" }
  }

  const keypress = (event: Pick<KeyEvent, "name" | "eventType">): void => {
    if (state.kind !== "idle") {
      if (event.name === state.key && (event.eventType === "press" || event.eventType === "repeat")) return
      cancel()
      return
    }
    if (!isCtrlModifierKeyName(event.name) || event.eventType !== "press") return

    const key = event.name
    const timer = setTimeout(() => {
      state = { kind: "visible", key }
      callbacks.onReveal()
    }, CTRL_HOLD_THRESHOLD_MS)
    state = { kind: "pending", key, timer }
  }

  const keyrelease = (event: Pick<KeyEvent, "name" | "eventType">): void => {
    if (state.kind !== "idle" && event.name === state.key) cancel()
  }

  return { keypress, keyrelease, cancel }
}

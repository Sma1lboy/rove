export type HapticKind = "light" | "medium" | "success" | "warning"

/** A tap the finger feels, inside the iPhone app (its `haptic` message handler); nothing anywhere else. */
export function haptic(kind: HapticKind = "light"): void {
  ;(
    globalThis as typeof globalThis & {
      webkit?: { messageHandlers?: { haptic?: { postMessage(kind: HapticKind): void } } }
    }
  ).webkit?.messageHandlers?.haptic?.postMessage(kind)
}

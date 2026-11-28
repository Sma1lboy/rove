/** Structural subset of OpenTUI's `KeyEvent`, so the keymap stays free of `@opentui/core`. */
export type KeyEvent = {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  option: boolean
  super?: boolean
  raw: string
  eventType: "press" | "repeat" | "release"
  source: "raw" | "kitty"
  readonly defaultPrevented: boolean
  preventDefault(): void
}

import type { KeyEvent } from "@opentui/core"

/** Names OpenTUI assigns to kitty keyboard protocol modifier keycodes 57441-57454. */
export const KITTY_MODIFIER_KEY_NAMES = [
  "leftshift",
  "leftctrl",
  "leftalt",
  "leftsuper",
  "lefthyper",
  "leftmeta",
  "rightshift",
  "rightctrl",
  "rightalt",
  "rightsuper",
  "righthyper",
  "rightmeta",
  "iso_level3_shift",
  "iso_level5_shift",
] as const

export type KittyModifierKeyName = (typeof KITTY_MODIFIER_KEY_NAMES)[number]
export type CtrlModifierKeyName = Extract<KittyModifierKeyName, "leftctrl" | "rightctrl">

const KITTY_MODIFIER_KEYS: ReadonlySet<string> = new Set(KITTY_MODIFIER_KEY_NAMES)

export function isKittyModifierKeyName(name: string | undefined): name is KittyModifierKeyName {
  return name !== undefined && KITTY_MODIFIER_KEYS.has(name)
}

export function isKittyModifierKeyEvent(event: Pick<KeyEvent, "name">): boolean {
  return isKittyModifierKeyName(event.name)
}

export function isCtrlModifierKeyName(name: string | undefined): name is CtrlModifierKeyName {
  return name === "leftctrl" || name === "rightctrl"
}

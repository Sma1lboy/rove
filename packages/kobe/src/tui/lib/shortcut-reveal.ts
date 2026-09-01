/**
 * Framework-free policy for shortcut badges shown while the prefix is armed.
 *
 * The keymap remains the only shortcut source of truth. Clickable controls
 * name the binding they already represent; this module resolves that id to
 * the canonical live chord only when the current binding stack can run it.
 */

import { KobeKeymap, findBinding } from "../context/keybindings"
import { formatChord } from "./chord-glyphs"
import type { BindingReachability } from "./keymap-reachability"
import type { PrefixHudOption } from "./prefix-hud"

export type ShortcutCaptionInput = Readonly<{
  bindingId: string
  reachability: BindingReachability
  prefixKey: string | null
}>

/**
 * Resolve the control's real current chord. Cosmetic `hint.keys` values are
 * intentionally ignored: they may be summaries such as `j/k`, while this
 * badge promises the actual first registered direct or prefix chord.
 */
export function shortcutCaption(input: ShortcutCaptionInput): string | null {
  const binding = findBinding(input.bindingId)
  if (!binding) return null

  if (input.reachability.direct.has(input.bindingId)) {
    const direct = binding.keys[0]
    if (direct) return formatChord(direct)
  }

  if (input.prefixKey && input.reachability.prefix.has(input.bindingId)) {
    const stroke = binding.prefixKeys?.[0]
    if (stroke) return `${formatChord(input.prefixKey)} ${formatChord(stroke)}`
  }

  return null
}

/** Direct-shortcut guide rows from the live keymap, limited to actions runnable in the current Binding Stack. */
export function onePressGuideOptions(reachability: BindingReachability): PrefixHudOption[] {
  return KobeKeymap.filter(
    (binding) => binding.presentation === "onePress" && reachability.direct.has(binding.id),
  ).flatMap((binding) => binding.keys.map((stroke) => ({ stroke, action: binding.id })))
}

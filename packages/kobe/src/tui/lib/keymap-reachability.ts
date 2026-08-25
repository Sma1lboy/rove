/** Binding-stack reachability computations for the keymap dispatcher.
 *
 * These scans walk the binding stack top-down with the same enable/modal
 * gating but collect different facts. The per-keypress hot path uses the
 * early-exit helpers ({@link prefixReachable}, {@link inputPassthroughReachable});
 * cold callers ({@link bindingReachability}, {@link scanReachability}) pay for a
 * full scan when they need the collected sets/options. */

import type { Binding, RegisteredBinding } from "./keymap-dispatch"
import type { PrefixHudOption } from "./prefix-hud"

export type BindingReachability = {
  direct: ReadonlySet<string>
  prefix: ReadonlySet<string>
  /** The current input surface forwards unclaimed keys to a terminal. */
  inputPassthrough: boolean
}

export interface ReachabilityScan {
  prefixReachable: boolean
  inputPassthrough: boolean
  prefixOptions: PrefixHudOption[]
  directIds: ReadonlySet<string>
  prefixIds: ReadonlySet<string>
}

function hasReachableBinding(
  snapshot: readonly RegisteredBinding[],
  predicate: (binding: Binding) => boolean,
): boolean {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const cfg = snapshot[i]?.config()
    if (!cfg || cfg.enabled === false) continue
    if (cfg.bindings.some(predicate)) return true
    if (cfg.modal) return false
  }
  return false
}

/** Whether an enabled prefix row is reachable above the modal barrier. */
export const prefixReachable = (snapshot: readonly RegisteredBinding[]): boolean =>
  hasReachableBinding(snapshot, (binding) => binding.prefix === true)

/** True when the current focused input surface forwards keys to a PTY. */
export const inputPassthroughReachable = (snapshot: readonly RegisteredBinding[]): boolean =>
  hasReachableBinding(snapshot, (binding) => binding.passthrough === true)

/**
 * One top-down scan of the binding stack, collecting every reachability fact
 * cold callers need. The hot per-keypress path keeps its own early-exit
 * helpers so a hit or miss never pays for fields it does not use.
 */
export function scanReachability(snapshot: readonly RegisteredBinding[]): ReachabilityScan {
  const directIds = new Set<string>()
  const prefixIds = new Set<string>()
  let prefixReachable = false
  let inputPassthrough = false
  const prefixOptions: PrefixHudOption[] = []
  const seenPrefixKeys = new Set<string>()
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const cfg = snapshot[i]?.config()
    if (!cfg || cfg.enabled === false) continue
    for (const binding of cfg.bindings) {
      if (binding.passthrough) inputPassthrough = true
      if (binding.prefix === true) {
        prefixReachable = true
        if (binding.id) prefixIds.add(binding.id)
        if (!seenPrefixKeys.has(binding.key)) {
          seenPrefixKeys.add(binding.key)
          prefixOptions.push({ stroke: binding.key, action: binding.id ?? binding.key })
        }
      } else if (binding.id) {
        directIds.add(binding.id)
      }
    }
    if (cfg.modal) break
  }
  return { prefixReachable, inputPassthrough, prefixOptions, directIds, prefixIds }
}

/** Binding ids available above the active modal barrier right now. */
export function bindingReachability(snapshot: readonly RegisteredBinding[]): BindingReachability {
  const { directIds, prefixIds, inputPassthrough } = scanReachability(snapshot)
  return { direct: directIds, prefix: prefixIds, inputPassthrough }
}

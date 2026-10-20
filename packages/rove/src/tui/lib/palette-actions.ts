import { type Binding, type RegisteredBinding, currentPrefixConfiguration } from "./keymap-dispatch"
import { inputPassthroughReachable } from "./keymap-reachability"

export type PaletteAction = { id: string; key: string; prefix: boolean; run: () => boolean }

function availableActions(stack: readonly RegisteredBinding[]): { owner: number; binding: Binding }[] {
  const seen = new Set<string>()
  const actions: { owner: number; binding: Binding }[] = []
  const passthrough = inputPassthroughReachable(stack)
  for (const registration of [...stack].reverse()) {
    const config = registration.config()
    if (config.enabled === false) continue
    for (const binding of config.bindings) {
      if (binding.prefix && currentPrefixConfiguration().key === null) continue
      if (binding.yieldToPassthrough && passthrough) continue
      const chord = `${binding.prefix === true}:${binding.key}`
      if (seen.has(chord)) continue
      seen.add(chord)
      if (binding.id && binding.action) actions.push({ owner: registration.id, binding })
    }
    if (config.modal) break
  }
  return actions
}

/** Revalidate the originating registration after closing the palette's modal barrier. */
export function capturePaletteActions(stack: readonly RegisteredBinding[]): PaletteAction[] {
  const seen = new Set<string>()
  return availableActions(stack).flatMap(({ owner, binding }) => {
    const id = binding.id
    if (!id || id === "palette.open" || seen.has(id)) return []
    seen.add(id)
    return [
      {
        id,
        key: binding.key,
        prefix: binding.prefix === true,
        run: () => {
          const live = availableActions(stack).find(
            (entry) =>
              entry.owner === owner &&
              entry.binding.id === id &&
              entry.binding.key === binding.key &&
              entry.binding.prefix === binding.prefix,
          )
          if (!live?.binding.action) return false
          live.binding.action.run()
          return true
        },
      },
    ]
  })
}

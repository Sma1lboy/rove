/**
 * Drop-in for `@opentui/react`'s `useTerminalDimensions`, which adds one
 * renderer "resize" listener per calling component: ~25 call sites pass
 * Node's default 10 and the MaxListeners warning is printed over the TUI.
 * Here every caller shares one listener per renderer.
 *
 * Plain `useState`, not `useSyncExternalStore`: the latter renders on the sync
 * lane, splitting a resize into more commits than the layout updates it
 * would otherwise batch with.
 */

import type { CliRenderer } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useState } from "react"

type Dimensions = { width: number; height: number }

const subscribers = new WeakMap<CliRenderer, Set<() => void>>()

function subscribe(renderer: CliRenderer, fn: () => void): () => void {
  let subs = subscribers.get(renderer)
  if (!subs) {
    const set = new Set<() => void>()
    subs = set
    subscribers.set(renderer, set)
    renderer.on("resize", () => {
      for (const f of set) f()
    })
  }
  subs.add(fn)
  return () => subs.delete(fn)
}

export function useTerminalDimensions(): Dimensions {
  const renderer = useRenderer()
  const [dims, setDims] = useState<Dimensions>(() => ({ width: renderer.width, height: renderer.height }))
  useEffect(() => {
    const sync = () =>
      setDims((d) =>
        d.width === renderer.width && d.height === renderer.height
          ? d
          : { width: renderer.width, height: renderer.height },
      )
    // A resize between render and this effect would otherwise be missed.
    sync()
    return subscribe(renderer, sync)
  }, [renderer])
  return dims
}

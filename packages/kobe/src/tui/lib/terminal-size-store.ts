/**
 * Terminal size for components, on ONE `resize` listener per renderer.
 *
 * `@opentui/react`'s `useTerminalDimensions` registers its own renderer
 * listener per caller; with a dozen mounted callers the renderer passes
 * Node's default of 10 and prints a MaxListenersExceededWarning straight into
 * the terminal. Here every caller shares a store that attaches on the first
 * subscriber and detaches after the last.
 */

export type TerminalSize = { readonly width: number; readonly height: number }

/** The slice of the renderer the store needs; a fake in tests. */
export interface ResizeSource {
  readonly width: number
  readonly height: number
  on(event: "resize", listener: () => void): unknown
  off(event: "resize", listener: () => void): unknown
}

type Store = { subscribe: (listener: () => void) => () => void; snapshot: () => TerminalSize }

const stores = new WeakMap<ResizeSource, Store>()

export function terminalSizeStore(source: ResizeSource): Store {
  const existing = stores.get(source)
  if (existing) return existing
  const listeners = new Set<() => void>()
  let size: TerminalSize = { width: source.width, height: source.height }
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const store: Store = {
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) source.on("resize", notify)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) source.off("resize", notify)
      }
    },
    // Read through to the renderer so a resize between subscriptions is never stale;
    // the object only changes identity when the size does.
    snapshot() {
      if (size.width !== source.width || size.height !== source.height) {
        size = { width: source.width, height: source.height }
      }
      return size
    },
  }
  stores.set(source, store)
  return store
}

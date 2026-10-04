/**
 * One renderer-root mouse-down listener shared by every outside-click
 * dismissal. Mouse events bubble to the root unless stopped, and nothing
 * stops the DOWN phase (pane guards sit on `onMouseUp`), so root-level down
 * means "pressed somewhere". A surface that must not dismiss on its own press
 * stops its down event (see `ui/context-menu.tsx`). React face:
 * `use-global-mouse-down.ts`.
 */

/** Structural slice of a renderable, so tests can pass a plain object. */
export interface MouseDownHost {
  onMouseDown: ((event: unknown) => void) | undefined
}

const subscribers = new Set<(event: unknown) => void>()
let installedHost: MouseDownHost | null = null

function dispatch(event: unknown): void {
  // Copy: a handler may unsubscribe itself (dismiss → unmount) mid-dispatch.
  for (const handler of [...subscribers]) handler(event)
}

/** The root listener exists only while there is at least one subscriber. */
export function subscribeGlobalMouseDown(host: MouseDownHost, handler: (event: unknown) => void): () => void {
  subscribers.add(handler)
  // Re-point on a host swap (fresh renderer per test); the old root is dead.
  if (installedHost !== host) {
    if (installedHost) installedHost.onMouseDown = undefined
    installedHost = host
    host.onMouseDown = dispatch
  }
  return () => {
    subscribers.delete(handler)
    if (subscribers.size === 0 && installedHost) {
      installedHost.onMouseDown = undefined
      installedHost = null
    }
  }
}

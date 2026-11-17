import { useEffect } from "react"

interface MacChannel {
  postMessage(message: Record<string, unknown>): void
}

export const macHost = (
  globalThis as typeof globalThis & {
    webkit?: { messageHandlers?: { roveMac?: MacChannel } }
  }
).webkit?.messageHandlers?.roveMac

export interface MacEvent {
  action: string
  id?: string
  data?: string
  cols?: number
  rows?: number
  selected?: boolean
  chars?: number
}

export function onMacEvent(consume: (event: MacEvent) => void): () => void {
  const handle = (event: Event) => consume((event as CustomEvent<MacEvent>).detail)
  window.addEventListener("rove-mac", handle)
  return () => window.removeEventListener("rove-mac", handle)
}

/** The title bar uses the very same history cursor and sidebar state as the web buttons. */
export function useMacToolbar(
  folded: boolean,
  waiting: boolean,
  back: boolean,
  forward: boolean,
  go: (n: number) => void,
  fold: () => void,
) {
  useEffect(() => {
    if (!macHost) return
    macHost.postMessage({
      op: "toolbar",
      folded,
      waiting,
      back,
      forward,
      dark: getComputedStyle(document.documentElement).colorScheme !== "light",
    })
    return onMacEvent(({ action }) => {
      if (action === "fold") fold()
      if (action === "back" && back) go(-1)
      if (action === "forward" && forward) go(1)
    })
  }, [folded, waiting, back, forward, go, fold])
}

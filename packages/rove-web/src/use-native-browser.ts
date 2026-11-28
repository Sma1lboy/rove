/**
 * React hook driving an Electron `WebContentsView` inside `BrowserView`'s stage rect.
 * Returns `null` in browser-only `rove --web` mode so `BrowserView` falls back to `<iframe>`.
 */

import { type RefObject, useCallback, useEffect, useRef, useState } from "react"
import {
  type DesktopBrowserTabInfo,
  browserPanelKey,
  desktopBrowser,
  takeAdoptedTab,
  watchOverlayOcclusion,
} from "./desktop-browser.ts"
import { t } from "./i18n/index.ts"
import { toast } from "./ui.ts"

export interface NativeBrowserHandle {
  readonly state: DesktopBrowserTabInfo | null
  navigate(url: string): void
  goBack(): void
  goForward(): void
  reload(): void
  toggleHandoff(): void
  captureDataUrl(): Promise<string>
}

export function useNativeBrowser(opts: {
  readonly taskId: string
  readonly tabId: string
  readonly url: string
  readonly enabled: boolean
  readonly shown: boolean
  readonly paused: boolean
  readonly stage: RefObject<HTMLDivElement | null>
  readonly onUrlSync: (url: string) => void
}): NativeBrowserHandle | null {
  const bridge = desktopBrowser()
  const panelKey = browserPanelKey(opts.taskId, opts.tabId)
  const [state, setState] = useState<DesktopBrowserTabInfo | null>(null)
  const [occluded, setOccluded] = useState(false)
  const idRef = useRef<string | null>(null)
  const urlRef = useRef(opts.url)
  urlRef.current = opts.url
  const onUrlSyncRef = useRef(opts.onUrlSync)
  onUrlSyncRef.current = opts.onUrlSync

  // Hide the native WebContentsView whenever a modal dialog or menu is open above the page.
  useEffect(() => {
    if (!bridge) return
    return watchOverlayOcclusion(setOccluded)
  }, [bridge])

  // Attach (or adopt a handed-off live view) once a web URL is loaded in this tab.
  useEffect(() => {
    if (!bridge || !opts.enabled || !opts.url) return
    let live = true
    const adoptTabId = takeAdoptedTab(panelKey)
    void bridge
      .attach({ panelKey, taskId: opts.taskId, url: opts.url, ...(adoptTabId ? { adoptTabId } : {}) })
      .then((info) => {
        if (!live) return
        idRef.current = info.id
        setState(info)
        // If already attached on a different URL (e.g. panel-show pushed a new address), navigate it.
        if (info.url && info.url !== opts.url && !adoptTabId) {
          void bridge.navigate(info.id, opts.url)
        }
      })
      .catch(() => {
        /* desktop window closing or bridge unavailable */
      })
    return () => {
      live = false
      const id = idRef.current
      if (id) void bridge.setVisible(id, false).catch(() => {})
    }
  }, [bridge, opts.enabled, opts.taskId, panelKey, opts.url])

  // Subscribe to main-process navigation, title, loading, and handoff state updates for this tab.
  useEffect(() => {
    if (!bridge || !opts.enabled) return
    return bridge.onState((info) => {
      if (info.panelKey !== panelKey && info.id !== idRef.current) return
      idRef.current = info.id
      setState(info)
      if (info.url && /^https?:\/\//i.test(info.url) && info.url !== urlRef.current) {
        onUrlSyncRef.current(info.url)
      }
    })
  }, [bridge, opts.enabled, panelKey])

  // Keep the native WebContentsView aligned with the stage box whenever visible and unobstructed.
  const tabId = state?.id ?? null
  const shouldShow = Boolean(bridge && opts.enabled && opts.shown && !opts.paused && !occluded && tabId)
  useEffect(() => {
    if (!bridge || !tabId) return
    const el = opts.stage.current
    if (!shouldShow || !el) {
      void bridge.setVisible(tabId, false).catch(() => {})
      return
    }
    let frame = 0
    const sync = () => {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) {
        void bridge.setVisible(tabId, false).catch(() => {})
        return
      }
      void bridge.setBounds(tabId, { x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => {})
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(sync)
    }
    sync()
    const resize = new ResizeObserver(schedule)
    resize.observe(el)
    window.addEventListener("resize", schedule)
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      window.removeEventListener("resize", schedule)
      void bridge.setVisible(tabId, false).catch(() => {})
    }
  }, [bridge, tabId, shouldShow, opts.stage])

  const navigate = useCallback(
    (nextUrl: string) => {
      const id = idRef.current
      if (!bridge || !id) return
      void bridge
        .navigate(id, nextUrl)
        .then((info) => setState(info))
        .catch(() => {})
    },
    [bridge],
  )

  const goBack = useCallback(() => {
    const id = idRef.current
    if (!bridge || !id) return
    void bridge
      .goBack(id)
      .then((info) => setState(info))
      .catch(() => {})
  }, [bridge])

  const goForward = useCallback(() => {
    const id = idRef.current
    if (!bridge || !id) return
    void bridge
      .goForward(id)
      .then((info) => setState(info))
      .catch(() => {})
  }, [bridge])

  const reload = useCallback(() => {
    const id = idRef.current
    if (!bridge || !id) return
    void bridge
      .reload(id)
      .then((info) => setState(info))
      .catch(() => {})
  }, [bridge])

  const toggleHandoff = useCallback(() => {
    const id = idRef.current
    if (!bridge || !id) return
    const nextOwner = state?.owner === "agent" ? "human" : "agent"
    void bridge
      .handoff(id, nextOwner)
      .then((event) => {
        toast(t(event.owner === "agent" ? "browser.handedToAgent" : "browser.handedToHuman", { id: event.id }), "info")
      })
      .catch(() => {})
  }, [bridge, state?.owner])

  const captureDataUrl = useCallback(async () => {
    const id = idRef.current
    if (!bridge || !id) throw new Error("native browser tab is not ready")
    const base64 = await bridge.capture(id)
    return `data:image/png;base64,${base64}`
  }, [bridge])

  if (!bridge) return null
  return { state, navigate, goBack, goForward, reload, toggleHandoff, captureDataUrl }
}

/**
 * Renderer side of the Electron `rove-desktop` native `WebContentsView` browser.
 * Absent in browser-only `rove --web` mode, where `BrowserView` keeps its `<iframe>` fallback.
 */

export type DesktopBrowserOwner = "human" | "agent"

export interface DesktopBrowserBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface DesktopBrowserTabInfo {
  readonly id: string
  readonly panelKey?: string
  readonly taskId?: string
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly visible: boolean
  readonly active: boolean
  readonly owner: DesktopBrowserOwner
  readonly handoffReason?: string
  readonly handoffAt?: number
}

export interface DesktopBrowserHandoffEvent {
  readonly id: string
  readonly panelKey?: string
  readonly taskId?: string
  readonly url: string
  readonly title: string
  readonly owner: DesktopBrowserOwner
  readonly previousOwner: DesktopBrowserOwner
  readonly reason?: string
  readonly at: number
}

export interface DesktopBrowserBridge {
  attach(opts: {
    panelKey: string
    taskId?: string
    url?: string
    adoptTabId?: string
  }): Promise<DesktopBrowserTabInfo>
  setBounds(id: string, bounds: DesktopBrowserBounds): Promise<void>
  setVisible(id: string, visible: boolean): Promise<void>
  navigate(id: string, url: string): Promise<DesktopBrowserTabInfo>
  goBack(id: string): Promise<DesktopBrowserTabInfo>
  goForward(id: string): Promise<DesktopBrowserTabInfo>
  reload(id: string): Promise<DesktopBrowserTabInfo>
  closeByPanelKey(panelKey: string): Promise<boolean>
  handoff(id: string, owner?: DesktopBrowserOwner, reason?: string): Promise<DesktopBrowserHandoffEvent>
  capture(id: string): Promise<string>
  onState(listener: (info: DesktopBrowserTabInfo) => void): () => void
  onHandoff(listener: (event: DesktopBrowserHandoffEvent) => void): () => void
  onFocus(listener: (info: DesktopBrowserTabInfo) => void): () => void
  onClosed(listener: (payload: { id: string; panelKey?: string }) => void): () => void
}

declare global {
  interface Window {
    roveDesktop?: {
      readonly browser?: DesktopBrowserBridge
    }
  }
}

export function desktopBrowser(): DesktopBrowserBridge | null {
  return typeof window !== "undefined" ? (window.roveDesktop?.browser ?? null) : null
}

export function hasDesktopBrowser(): boolean {
  return desktopBrowser() !== null
}

export function browserPanelKey(taskId: string, tabId: string): string {
  return `${taskId}:${tabId}`
}

/** Pending live desktop tab id to adopt when a newly opened panel tab attaches. */
const pendingAdoptions = new Map<string, string>()

export function queueAdoptedTab(panelKey: string, desktopTabId: string): void {
  pendingAdoptions.set(panelKey, desktopTabId)
}

export function takeAdoptedTab(panelKey: string): string | undefined {
  const id = pendingAdoptions.get(panelKey)
  if (id !== undefined) pendingAdoptions.delete(panelKey)
  return id
}

export function closeNativePanelTab(taskId: string, tabId: string): void {
  const bridge = desktopBrowser()
  if (!bridge) return
  void bridge.closeByPanelKey(browserPanelKey(taskId, tabId)).catch(() => {
    /* tab already closed or window shutting down */
  })
}

const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"], dialog[open]'

/**
 * Native `WebContentsView`s paint above HTML, so hide them while any modal dialog or context menu
 * is open in the document.
 */
export function watchOverlayOcclusion(onChange: (occluded: boolean) => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {}
  let last = Boolean(document.querySelector(OVERLAY_SELECTOR))
  onChange(last)
  const check = () => {
    const next = Boolean(document.querySelector(OVERLAY_SELECTOR))
    if (next !== last) {
      last = next
      onChange(next)
    }
  }
  const observer = new MutationObserver(check)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] })
  return () => observer.disconnect()
}

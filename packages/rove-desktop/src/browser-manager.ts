/**
 * Native Electron `WebContentsView` manager for the side-panel Browser and `rove api web`.
 *
 * Each browser tab owns an isolated `WebContentsView` backed by the shared persistent partition
 * (`persist:rove-browser`) so cookies and logins survive restarts and stay separate from Rove's
 * own bridge origin session. Views are attached to the main `BrowserWindow.contentView` only
 * while visible, with real Chromium back/forward navigation (`navigationHistory`), CDP automation,
 * and live human↔agent handoff.
 */

import { type BrowserWindow, WebContentsView, session } from "electron"
import { type AutomationTab, batchTab, evalTab, navigateContents, snapTab } from "./browser-automation"
import { fetchFromTab } from "./browser-fetch"
import {
  type BatchResult,
  type BatchStep,
  type BrowserBounds,
  type BrowserHandoffEvent,
  type BrowserOwner,
  type BrowserTabInfo,
  type FetchResult,
  type SnapshotResult,
  clampBounds,
  validateBrowserUrl,
} from "./browser-protocol"

export const BROWSER_PARTITION = "persist:rove-browser"

interface ManagedTab extends AutomationTab {
  readonly view: WebContentsView
  panelKey?: string
  taskId?: string
  owner: BrowserOwner
  handoffReason?: string
  handoffAt?: number
  visible: boolean
  bounds: BrowserBounds
  loading: boolean
}

const ALLOWED_BROWSER_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen"])

export class BrowserManager {
  private readonly tabs = new Map<string, ManagedTab>()
  private readonly byPanelKey = new Map<string, string>()
  private activeId: string | null = null
  private nextNum = 1
  private window: BrowserWindow | null = null
  private bridgeOrigin: string | null = null
  private partitionConfigured = false

  constructor(private readonly log: (message: string) => void) {}

  setWindow(win: BrowserWindow | null, bridgeOrigin: string | null): void {
    if (this.window && this.window !== win && !this.window.isDestroyed()) {
      for (const tab of this.tabs.values()) {
        this.detachView(this.window, tab)
      }
    }
    this.window = win
    this.bridgeOrigin = bridgeOrigin
    if (win) this.configurePartition()
  }

  private configurePartition(): void {
    if (this.partitionConfigured) return
    this.partitionConfigured = true
    const ses = session.fromPartition(BROWSER_PARTITION)
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_BROWSER_PERMISSIONS.has(permission))
    })
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_BROWSER_PERMISSIONS.has(permission))
  }

  private emitToRenderer(channel: string, payload: unknown): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send(channel, payload)
  }

  private infoOf(tab: ManagedTab): BrowserTabInfo {
    const wc = tab.view.webContents
    const destroyed = wc.isDestroyed()
    return {
      id: tab.id,
      ...(tab.panelKey ? { panelKey: tab.panelKey } : {}),
      ...(tab.taskId ? { taskId: tab.taskId } : {}),
      url: destroyed ? "" : wc.getURL(),
      title: destroyed ? "" : wc.getTitle(),
      loading: tab.loading,
      canGoBack: destroyed ? false : wc.navigationHistory.canGoBack(),
      canGoForward: destroyed ? false : wc.navigationHistory.canGoForward(),
      visible: tab.visible,
      active: this.activeId === tab.id,
      owner: tab.owner,
      ...(tab.handoffReason ? { handoffReason: tab.handoffReason } : {}),
      ...(tab.handoffAt !== undefined ? { handoffAt: tab.handoffAt } : {}),
    }
  }

  private pushState(tab: ManagedTab): void {
    this.emitToRenderer("rove-browser:state", this.infoOf(tab))
  }

  private detachView(win: BrowserWindow, tab: ManagedTab): void {
    try {
      win.contentView.removeChildView(tab.view)
    } catch {
      /* view was not attached to this window */
    }
    tab.visible = false
  }

  private createTab(opts: {
    readonly panelKey?: string
    readonly taskId?: string
    readonly owner: BrowserOwner
    readonly url?: string
  }): ManagedTab {
    this.configurePartition()
    const id = `b-${this.nextNum++}`
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
      },
    })
    view.setBackgroundColor("#141413")
    // Give background agent tabs a real desktop viewport before they are attached to the side panel.
    view.setBounds({ x: 0, y: 0, width: 1280, height: 800 })
    const tab: ManagedTab = {
      id,
      view,
      webContents: view.webContents,
      refs: new Map(),
      ...(opts.panelKey ? { panelKey: opts.panelKey } : {}),
      ...(opts.taskId ? { taskId: opts.taskId } : {}),
      owner: opts.owner,
      visible: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      loading: false,
    }
    this.tabs.set(id, tab)
    if (opts.panelKey) this.byPanelKey.set(opts.panelKey, id)
    this.activeId = id

    const wc = view.webContents
    wc.setWindowOpenHandler(({ url }) => {
      try {
        const valid = validateBrowserUrl(url, this.bridgeOrigin)
        void wc.loadURL(valid.href)
      } catch {
        /* ignore unsupported or self-origin popup URLs */
      }
      return { action: "deny" }
    })
    wc.on("will-navigate", (event, url) => {
      try {
        validateBrowserUrl(url, this.bridgeOrigin)
      } catch {
        event.preventDefault()
      }
    })
    wc.on("did-start-loading", () => {
      tab.loading = true
      this.pushState(tab)
    })
    wc.on("did-stop-loading", () => {
      tab.loading = false
      this.pushState(tab)
    })
    wc.on("did-navigate", () => {
      tab.refs = new Map()
      this.pushState(tab)
    })
    wc.on("did-navigate-in-page", () => {
      this.pushState(tab)
    })
    wc.on("page-title-updated", () => {
      this.pushState(tab)
    })
    wc.on("did-fail-load", (_e, code, description, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      tab.loading = false
      this.log(`browser ${id} load failed (${code}): ${description} ${failedUrl}`)
      this.pushState(tab)
    })
    return tab
  }

  private resolveTab(id?: string, taskId?: string): ManagedTab {
    if (id) {
      const direct = this.tabs.get(id)
      if (direct) return direct
      if (taskId) {
        const byPanel = this.byPanelKey.get(`${taskId}:${id}`)
        if (byPanel && this.tabs.has(byPanel)) return this.tabs.get(byPanel)!
      }
      for (const tab of this.tabs.values()) {
        if (tab.panelKey === id) return tab
      }
      throw new Error(`TAB_NOT_FOUND: browser tab "${id}" not found`)
    }
    if (taskId) {
      const active = this.activeId ? this.tabs.get(this.activeId) : undefined
      if (active?.taskId === taskId) return active
      const matching = [...this.tabs.values()].find((t) => t.taskId === taskId)
      if (matching) return matching
    }
    if (this.activeId && this.tabs.has(this.activeId)) return this.tabs.get(this.activeId)!
    const first = this.tabs.values().next().value
    if (first) return first
    throw new Error("TAB_NOT_FOUND: no browser tab is open — open one with `rove api web tab new --url <url>`")
  }

  /** Called by the renderer when a side-panel Browser tab mounts or navigates. */
  async attachPanelTab(opts: {
    readonly panelKey: string
    readonly taskId?: string
    readonly url?: string
    readonly adoptTabId?: string
  }): Promise<BrowserTabInfo> {
    const existingId = this.byPanelKey.get(opts.panelKey)
    let tab = existingId ? this.tabs.get(existingId) : undefined
    if (!tab && opts.adoptTabId) {
      const adopted = this.tabs.get(opts.adoptTabId)
      if (adopted) {
        if (adopted.panelKey) this.byPanelKey.delete(adopted.panelKey)
        adopted.panelKey = opts.panelKey
        if (opts.taskId) adopted.taskId = opts.taskId
        this.byPanelKey.set(opts.panelKey, adopted.id)
        tab = adopted
      }
    }
    if (!tab) {
      tab = this.createTab({ panelKey: opts.panelKey, taskId: opts.taskId, owner: "human" })
      if (opts.url) {
        const valid = validateBrowserUrl(opts.url, this.bridgeOrigin)
        void tab.view.webContents.loadURL(valid.href).catch(() => {
          /* load errors report through did-fail-load */
        })
      }
    }
    return this.infoOf(tab)
  }

  setBounds(id: string, bounds: BrowserBounds): void {
    const tab = this.tabs.get(id)
    if (!tab || !this.window || this.window.isDestroyed()) return
    const next = clampBounds(bounds)
    tab.bounds = next
    if (next.width <= 0 || next.height <= 0) {
      this.setVisible(id, false)
      return
    }
    if (!tab.visible) {
      // Only one tab displays per stage slot at a time; ensure this view is on top.
      this.window.contentView.addChildView(tab.view)
      tab.view.setVisible(true)
      tab.visible = true
      this.activeId = tab.id
    }
    tab.view.setBounds(next)
  }

  setVisible(id: string, visible: boolean): void {
    const tab = this.tabs.get(id)
    if (!tab || !this.window || this.window.isDestroyed()) return
    if (!visible) {
      if (tab.visible) {
        tab.view.setVisible(false)
        this.detachView(this.window, tab)
      }
      return
    }
    if (tab.bounds.width <= 0 || tab.bounds.height <= 0) return
    this.window.contentView.addChildView(tab.view)
    tab.view.setBounds(tab.bounds)
    tab.view.setVisible(true)
    tab.visible = true
    this.activeId = tab.id
  }

  async capturePngBase64(id: string): Promise<string> {
    const tab = this.resolveTab(id)
    const image = await tab.view.webContents.capturePage()
    return image.toPNG().toString("base64")
  }

  listTabs(taskId?: string): { tabs: BrowserTabInfo[]; activeTabId: string | null } {
    const tabs = [...this.tabs.values()].filter((t) => !taskId || t.taskId === taskId).map((t) => this.infoOf(t))
    return { tabs, activeTabId: this.activeId }
  }

  async newTab(opts: {
    readonly url?: string
    readonly taskId?: string
    readonly owner?: BrowserOwner
    readonly waitUntil?: "load" | "domcontentloaded" | "none"
    readonly timeoutMs?: number
  }): Promise<BrowserTabInfo> {
    const tab = this.createTab({ taskId: opts.taskId, owner: opts.owner ?? "agent" })
    if (opts.url) {
      await navigateContents(tab.view.webContents, opts.url, {
        bridgeOrigin: this.bridgeOrigin,
        waitUntil: opts.waitUntil ?? "load",
        timeoutMs: opts.timeoutMs,
      })
    }
    const info = this.infoOf(tab)
    if (tab.owner === "human") {
      this.emitToRenderer("rove-browser:handoff", {
        id: tab.id,
        taskId: tab.taskId,
        url: info.url,
        title: info.title,
        owner: "human",
        previousOwner: "agent",
        at: Date.now(),
      } satisfies BrowserHandoffEvent)
    }
    return info
  }

  closeTab(id: string, taskId?: string): { closed: boolean; id: string } {
    const tab = this.resolveTab(id, taskId)
    this.destroyTab(tab)
    return { closed: true, id: tab.id }
  }

  closeByPanelKey(panelKey: string): boolean {
    const id = this.byPanelKey.get(panelKey)
    if (!id) return false
    const tab = this.tabs.get(id)
    if (!tab) return false
    this.destroyTab(tab)
    return true
  }

  private destroyTab(tab: ManagedTab): void {
    if (this.window && !this.window.isDestroyed()) this.detachView(this.window, tab)
    if (tab.panelKey) this.byPanelKey.delete(tab.panelKey)
    this.tabs.delete(tab.id)
    if (this.activeId === tab.id) {
      this.activeId = this.tabs.keys().next().value ?? null
    }
    if (!tab.view.webContents.isDestroyed()) {
      if (tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.detach()
      tab.view.webContents.close()
    }
    this.emitToRenderer("rove-browser:closed", { id: tab.id, panelKey: tab.panelKey })
  }

  focusTab(id: string, taskId?: string): BrowserTabInfo {
    const tab = this.resolveTab(id, taskId)
    this.activeId = tab.id
    if (this.window && !this.window.isDestroyed() && tab.bounds.width > 0 && tab.bounds.height > 0) {
      this.window.contentView.addChildView(tab.view)
      tab.view.setBounds(tab.bounds)
      tab.view.setVisible(true)
      tab.visible = true
    }
    const info = this.infoOf(tab)
    this.emitToRenderer("rove-browser:focus", info)
    return info
  }

  /** Hand a live logged-in tab between human and agent without reloading or losing cookies/DOM. */
  handoffTab(opts: {
    readonly id?: string
    readonly taskId?: string
    readonly owner?: BrowserOwner
    readonly reason?: string
  }): BrowserHandoffEvent {
    const tab = this.resolveTab(opts.id, opts.taskId)
    const previousOwner = tab.owner
    const owner: BrowserOwner = opts.owner ?? (previousOwner === "agent" ? "human" : "agent")
    const at = Date.now()
    tab.owner = owner
    tab.handoffReason = opts.reason
    tab.handoffAt = at
    if (!tab.taskId && opts.taskId) tab.taskId = opts.taskId
    this.activeId = tab.id
    const event: BrowserHandoffEvent = {
      id: tab.id,
      ...(tab.panelKey ? { panelKey: tab.panelKey } : {}),
      ...(tab.taskId ? { taskId: tab.taskId } : {}),
      url: tab.view.webContents.getURL(),
      title: tab.view.webContents.getTitle(),
      owner,
      previousOwner,
      ...(opts.reason ? { reason: opts.reason } : {}),
      at,
    }
    this.pushState(tab)
    this.emitToRenderer("rove-browser:handoff", event)
    return event
  }

  async navigate(opts: {
    readonly id?: string
    readonly taskId?: string
    readonly url?: string
    readonly go?: "back" | "forward" | "reload"
    readonly waitUntil?: "load" | "domcontentloaded" | "none"
    readonly timeoutMs?: number
  }): Promise<BrowserTabInfo> {
    if (!opts.id && opts.url && this.tabs.size === 0) {
      return this.newTab({ url: opts.url, taskId: opts.taskId, waitUntil: opts.waitUntil, timeoutMs: opts.timeoutMs })
    }
    const tab = this.resolveTab(opts.id, opts.taskId)
    const wc = tab.view.webContents
    if (opts.go === "back") {
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    } else if (opts.go === "forward") {
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    } else if (opts.go === "reload") {
      wc.reload()
    } else if (opts.url) {
      await navigateContents(wc, opts.url, {
        bridgeOrigin: this.bridgeOrigin,
        waitUntil: opts.waitUntil ?? "load",
        timeoutMs: opts.timeoutMs,
      })
    } else {
      throw new Error("nav requires --url or --go back|forward|reload")
    }
    this.activeId = tab.id
    const info = this.infoOf(tab)
    this.pushState(tab)
    return info
  }

  async snap(opts: {
    readonly id?: string
    readonly taskId?: string
    readonly interactive?: boolean
    readonly root?: string
    readonly maxNodes?: number
  }): Promise<SnapshotResult> {
    const tab = this.resolveTab(opts.id, opts.taskId)
    return snapTab(tab, { interactive: opts.interactive, root: opts.root, maxNodes: opts.maxNodes })
  }

  async eval(opts: {
    readonly id?: string
    readonly taskId?: string
    readonly expr: string
    readonly awaitPromise?: boolean
  }): Promise<{ id: string; url: string; value: unknown; undefined?: true }> {
    const tab = this.resolveTab(opts.id, opts.taskId)
    return evalTab(tab, opts.expr, { awaitPromise: opts.awaitPromise })
  }

  async batch(opts: {
    readonly id?: string
    readonly taskId?: string
    readonly steps: readonly BatchStep[]
  }): Promise<BatchResult> {
    const tab = this.resolveTab(opts.id, opts.taskId)
    return batchTab(tab, opts.steps, { bridgeOrigin: this.bridgeOrigin })
  }

  async fetch(opts: {
    readonly id?: string
    readonly taskId?: string
    readonly url: string
    readonly method?: string
    readonly headers?: Readonly<Record<string, string>>
    readonly body?: string
  }): Promise<FetchResult> {
    const tab = this.resolveTab(opts.id, opts.taskId)
    return fetchFromTab(tab, {
      url: opts.url,
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      bridgeOrigin: this.bridgeOrigin,
    })
  }

  dispose(): void {
    for (const tab of [...this.tabs.values()]) {
      this.destroyTab(tab)
    }
    this.window = null
  }
}

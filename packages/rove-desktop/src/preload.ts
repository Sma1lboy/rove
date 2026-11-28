/**
 * Minimal sandboxed preload for the main Rove window only (never attached to embedded browser
 * WebContentsViews). Exposes only the narrow native browser control API; every IPC call is
 * origin-checked in the main process against the local bridge origin.
 */

import { contextBridge, ipcRenderer } from "electron"
import type { BrowserBounds, BrowserHandoffEvent, BrowserOwner, BrowserTabInfo } from "./browser-protocol"

export interface DesktopBrowserBridge {
  attach(opts: { panelKey: string; taskId?: string; url?: string; adoptTabId?: string }): Promise<BrowserTabInfo>
  setBounds(id: string, bounds: BrowserBounds): Promise<void>
  setVisible(id: string, visible: boolean): Promise<void>
  navigate(id: string, url: string): Promise<BrowserTabInfo>
  goBack(id: string): Promise<BrowserTabInfo>
  goForward(id: string): Promise<BrowserTabInfo>
  reload(id: string): Promise<BrowserTabInfo>
  closeByPanelKey(panelKey: string): Promise<boolean>
  handoff(id: string, owner?: BrowserOwner, reason?: string): Promise<BrowserHandoffEvent>
  capture(id: string): Promise<string>
  onState(listener: (info: BrowserTabInfo) => void): () => void
  onHandoff(listener: (event: BrowserHandoffEvent) => void): () => void
  onFocus(listener: (info: BrowserTabInfo) => void): () => void
  onClosed(listener: (payload: { id: string; panelKey?: string }) => void): () => void
}

const browser: DesktopBrowserBridge = {
  attach: (opts) => ipcRenderer.invoke("rove-browser:attach", opts),
  setBounds: (id, bounds) => ipcRenderer.invoke("rove-browser:bounds", id, bounds),
  setVisible: (id, visible) => ipcRenderer.invoke("rove-browser:visible", id, visible),
  navigate: (id, url) => ipcRenderer.invoke("rove-browser:nav", { id, url }),
  goBack: (id) => ipcRenderer.invoke("rove-browser:nav", { id, go: "back" }),
  goForward: (id) => ipcRenderer.invoke("rove-browser:nav", { id, go: "forward" }),
  reload: (id) => ipcRenderer.invoke("rove-browser:nav", { id, go: "reload" }),
  closeByPanelKey: (panelKey) => ipcRenderer.invoke("rove-browser:close-panel", panelKey),
  handoff: (id, owner, reason) => ipcRenderer.invoke("rove-browser:handoff", { id, owner, reason }),
  capture: (id) => ipcRenderer.invoke("rove-browser:capture", id),
  onState(listener) {
    const fn = (_e: Electron.IpcRendererEvent, info: BrowserTabInfo) => listener(info)
    ipcRenderer.on("rove-browser:state", fn)
    return () => ipcRenderer.removeListener("rove-browser:state", fn)
  },
  onHandoff(listener) {
    const fn = (_e: Electron.IpcRendererEvent, event: BrowserHandoffEvent) => listener(event)
    ipcRenderer.on("rove-browser:handoff", fn)
    return () => ipcRenderer.removeListener("rove-browser:handoff", fn)
  },
  onFocus(listener) {
    const fn = (_e: Electron.IpcRendererEvent, info: BrowserTabInfo) => listener(info)
    ipcRenderer.on("rove-browser:focus", fn)
    return () => ipcRenderer.removeListener("rove-browser:focus", fn)
  },
  onClosed(listener) {
    const fn = (_e: Electron.IpcRendererEvent, payload: { id: string; panelKey?: string }) => listener(payload)
    ipcRenderer.on("rove-browser:closed", fn)
    return () => ipcRenderer.removeListener("rove-browser:closed", fn)
  },
}

contextBridge.exposeInMainWorld("roveDesktop", { browser })

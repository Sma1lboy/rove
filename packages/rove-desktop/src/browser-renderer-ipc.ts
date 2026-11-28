/**
 * Origin-checked Electron `ipcMain` handlers connecting the main Rove window's sandboxed preload
 * (`preload.ts`) to `BrowserManager`. Never reachable from embedded `WebContentsView` origins.
 */

import { type IpcMainInvokeEvent, ipcMain } from "electron"
import type { BrowserManager } from "./browser-manager"
import type { BrowserBounds, BrowserOwner } from "./browser-protocol"

export function registerBrowserRendererIpc(manager: BrowserManager, allowedOrigin: () => string | null): void {
  const assertAllowed = (event: IpcMainInvokeEvent): void => {
    const expected = allowedOrigin()
    const url = event.senderFrame?.url
    if (!expected || !url) throw new Error("unauthorized browser IPC sender")
    let actual: string
    try {
      actual = new URL(url).origin
    } catch {
      throw new Error("unauthorized browser IPC sender")
    }
    if (actual !== expected) throw new Error("unauthorized browser IPC sender")
  }
  const handle = <Args extends unknown[], R>(channel: string, fn: (...args: Args) => Promise<R> | R): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (event, ...args) => {
      assertAllowed(event)
      return fn(...(args as Args))
    })
  }
  handle("rove-browser:attach", (opts: { panelKey: string; taskId?: string; url?: string; adoptTabId?: string }) =>
    manager.attachPanelTab(opts),
  )
  handle("rove-browser:bounds", (id: string, bounds: BrowserBounds) => manager.setBounds(id, bounds))
  handle("rove-browser:visible", (id: string, visible: boolean) => manager.setVisible(id, visible))
  handle("rove-browser:nav", (opts: { id: string; url?: string; go?: "back" | "forward" | "reload" }) =>
    manager.navigate({ ...opts, waitUntil: "none" }),
  )
  handle("rove-browser:close-panel", (panelKey: string) => manager.closeByPanelKey(panelKey))
  handle("rove-browser:handoff", (opts: { id: string; owner?: BrowserOwner; reason?: string }) =>
    manager.handoffTab(opts),
  )
  handle("rove-browser:capture", (id: string) => manager.capturePngBase64(id))
}

/**
 * Wire contract shared by the Electron main process, the sandboxed preload, and the local
 * browser IPC server (`rove api web`). Pure types and small helpers only — no Electron import.
 */

import { createHash } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

export type BrowserOwner = "human" | "agent"

export interface BrowserBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface BrowserTabInfo {
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
  readonly owner: BrowserOwner
  readonly handoffReason?: string
  readonly handoffAt?: number
}

export interface BrowserHandoffEvent {
  readonly id: string
  readonly panelKey?: string
  readonly taskId?: string
  readonly url: string
  readonly title: string
  readonly owner: BrowserOwner
  readonly previousOwner: BrowserOwner
  readonly reason?: string
  readonly at: number
}

export interface SnapshotNode {
  readonly ref: string
  readonly role: string
  readonly name: string
  readonly depth: number
  readonly interactive: boolean
  readonly value?: string
  readonly checked?: boolean | "mixed"
  readonly disabled?: boolean
  readonly expanded?: boolean
  readonly selected?: boolean
  readonly focused?: boolean
  readonly required?: boolean
  readonly level?: number
}

export interface SnapshotResult {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly interactive: boolean
  readonly root?: string
  readonly count: number
  readonly totalNodes: number
  readonly truncated: boolean
  readonly text: string
  readonly nodes: readonly SnapshotNode[]
}

export type BatchStep =
  | {
      readonly action: "nav"
      readonly url: string
      readonly waitUntil?: "load" | "domcontentloaded" | "none"
      readonly optional?: boolean
    }
  | { readonly action: "click"; readonly ref?: string; readonly selector?: string; readonly optional?: boolean }
  | {
      readonly action: "fill"
      readonly ref?: string
      readonly selector?: string
      readonly value: string
      readonly optional?: boolean
    }
  | {
      readonly action: "type"
      readonly ref?: string
      readonly selector?: string
      readonly text: string
      readonly optional?: boolean
    }
  | {
      readonly action: "press"
      readonly key: string
      readonly ref?: string
      readonly selector?: string
      readonly optional?: boolean
    }
  | {
      readonly action: "select"
      readonly ref?: string
      readonly selector?: string
      readonly value: string
      readonly optional?: boolean
    }
  | {
      readonly action: "check"
      readonly ref?: string
      readonly selector?: string
      readonly checked?: boolean
      readonly optional?: boolean
    }
  | { readonly action: "hover"; readonly ref?: string; readonly selector?: string; readonly optional?: boolean }
  | { readonly action: "focus"; readonly ref?: string; readonly selector?: string; readonly optional?: boolean }
  | {
      readonly action: "scroll"
      readonly ref?: string
      readonly selector?: string
      readonly x?: number
      readonly y?: number
      readonly optional?: boolean
    }
  | {
      readonly action: "wait"
      readonly ms?: number
      readonly selector?: string
      readonly text?: string
      readonly timeout?: number
      readonly optional?: boolean
    }
  | { readonly action: "eval"; readonly expr: string; readonly optional?: boolean }
  | {
      readonly action: "snap"
      readonly interactive?: boolean
      readonly root?: string
      readonly maxNodes?: number
      readonly optional?: boolean
    }

export interface BatchStepResult {
  readonly index: number
  readonly action: BatchStep["action"]
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: string
}

export interface BatchResult {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly ok: boolean
  readonly completed: number
  readonly total: number
  readonly results: readonly BatchStepResult[]
}

export interface FetchResult {
  readonly id: string
  readonly url: string
  readonly status: number
  readonly statusText: string
  readonly ok: boolean
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly json?: unknown
  readonly truncated?: boolean
}

export interface IpcRequest {
  readonly id: string
  readonly method: string
  readonly params?: Record<string, unknown>
}

export type IpcResponse =
  | { readonly id: string; readonly ok: true; readonly result: unknown }
  | { readonly id: string; readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Must match `defaultDesktopBrowserSocketPath` in `packages/rove-daemon/src/daemon/paths.ts`. */
export function desktopBrowserSocketPath(homeDir?: string, platform: NodeJS.Platform = process.platform): string {
  const override = process.env.ROVE_DESKTOP_BROWSER_SOCKET_PATH?.trim()
  if (override) return override
  const base = homeDir ?? process.env.ROVE_HOME_DIR?.trim() ?? homedir()
  const tag = createHash("sha1").update(base).digest("hex").slice(0, 8)
  if (platform === "win32") return `\\\\.\\pipe\\rove-${tag}-desktop-browser`
  const natural = join(base, ".rove", "desktop-browser.sock")
  if (Buffer.byteLength(natural, "utf8") <= 100) return natural
  return join(tmpdir(), `rove-${tag}-desktop-browser.sock`)
}

/** Validate a URL that may be loaded in a native browser view (`http(s)` only, never Rove's own bridge origin). */
export function validateBrowserUrl(raw: string, bridgeOrigin: string | null): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`invalid URL: ${raw}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported URL scheme "${url.protocol}": only http and https are allowed`)
  }
  if (bridgeOrigin && url.origin === bridgeOrigin) {
    throw new Error("cannot open Rove's own bridge origin inside the embedded browser")
  }
  return url
}

export function clampBounds(bounds: BrowserBounds): BrowserBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  }
}

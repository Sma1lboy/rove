/**
 * CDP-backed browser automation primitives for a single Electron `WebContents`:
 * `snap` (compact AX snapshot + `@eN` refs), `eval`, `batch` (multi-step actions),
 * and `fetch` (authenticated via the tab's page context or persistent Electron session).
 */

import type { WebContents } from "electron"
import {
  type BatchResult,
  type BatchStep,
  type BatchStepResult,
  type SnapshotResult,
  validateBrowserUrl,
} from "./browser-protocol"
import { type RawAxNode, buildSnapshot } from "./browser-snapshot"

const DEFAULT_WAIT_TIMEOUT_MS = 10_000
const MAX_WAIT_TIMEOUT_MS = 30_000
const DEFAULT_NAV_TIMEOUT_MS = 15_000

const KEY_CODES: Readonly<Record<string, { key: string; code: string; vk: number; text?: string }>> = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  Delete: { key: "Delete", code: "Delete", vk: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  Space: { key: " ", code: "Space", vk: 32, text: " " },
}

export interface AutomationTab {
  readonly id: string
  readonly webContents: WebContents
  readonly visible?: boolean
  refs: ReadonlyMap<string, number>
}

export async function ensureDebugger(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) throw new Error("tab is closed")
  if (!wc.debugger.isAttached()) {
    wc.debugger.attach("1.3")
  }
}

async function cdp<T = Record<string, unknown>>(
  wc: WebContents,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  await ensureDebugger(wc)
  return (await wc.debugger.sendCommand(method, params)) as T
}

/** Navigate `wc` and optionally wait for `load` or `domcontentloaded`. */
export async function navigateContents(
  wc: WebContents,
  url: string,
  opts: {
    readonly bridgeOrigin: string | null
    readonly waitUntil?: "load" | "domcontentloaded" | "none"
    readonly timeoutMs?: number
  },
): Promise<void> {
  const valid = validateBrowserUrl(url, opts.bridgeOrigin)
  const waitUntil = opts.waitUntil ?? "load"
  if (waitUntil === "none") {
    void wc.loadURL(valid.href).catch(() => {
      /* navigation errors surface via did-fail-load on the view */
    })
    return
  }
  const timeoutMs = Math.min(MAX_WAIT_TIMEOUT_MS, Math.max(500, opts.timeoutMs ?? DEFAULT_NAV_TIMEOUT_MS))
  const domReady = waitUntil === "domcontentloaded"
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (domReady) wc.removeListener("dom-ready", onLoad)
      else wc.removeListener("did-finish-load", onLoad)
      wc.removeListener("did-fail-load", onFail)
      fn()
    }
    const onLoad = () => done(resolve)
    const onFail = (_e: Electron.Event, code: number, desc: string, _url: string, isMainFrame: boolean) => {
      // ERR_ABORTED (-3) fires on normal client-side redirects; wait for the real target load.
      if (!isMainFrame || code === -3) return
      done(() => reject(new Error(`navigation failed (${code}): ${desc}`)))
    }
    const timer = setTimeout(
      () => done(() => reject(new Error(`navigation timed out after ${timeoutMs}ms`))),
      timeoutMs,
    )
    if (domReady) wc.once("dom-ready", onLoad)
    else wc.once("did-finish-load", onLoad)
    wc.on("did-fail-load", onFail)
    wc.loadURL(valid.href).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (/ERR_ABORTED|-3/.test(msg)) return
      done(() => reject(err instanceof Error ? err : new Error(msg)))
    })
  })
}

/** Take a compact accessibility/interactive snapshot via CDP and store `@eN` refs on the tab. */
export async function snapTab(
  tab: AutomationTab,
  opts: { readonly interactive?: boolean; readonly root?: string; readonly maxNodes?: number } = {},
): Promise<SnapshotResult> {
  const wc = tab.webContents
  let rootBackendNodeId: number | undefined
  if (opts.root) {
    rootBackendNodeId = tab.refs.get(opts.root)
    if (rootBackendNodeId === undefined) {
      throw new Error(`unknown snapshot ref "${opts.root}" — run snap first to obtain current @eN refs`)
    }
  }
  await cdp(wc, "Accessibility.enable")
  const { nodes: rawNodes } = await cdp<{ nodes: RawAxNode[] }>(wc, "Accessibility.getFullAXTree")
  const built = buildSnapshot(rawNodes, {
    interactive: opts.interactive,
    rootBackendNodeId,
    maxNodes: opts.maxNodes,
  })
  if (!built) {
    throw new Error(`snapshot root "${opts.root}" is no longer attached to the page — run snap again`)
  }
  tab.refs = built.refs
  return {
    id: tab.id,
    url: wc.getURL(),
    title: wc.getTitle(),
    interactive: opts.interactive === true,
    ...(opts.root ? { root: opts.root } : {}),
    count: built.nodes.length,
    totalNodes: built.totalNodes,
    truncated: built.truncated,
    text: built.text,
    nodes: built.nodes,
  }
}

/** Evaluate a JS expression in the tab's main world and return its JSON-serializable result. */
export async function evalTab(
  tab: AutomationTab,
  expr: string,
  opts: { readonly awaitPromise?: boolean } = {},
): Promise<{ id: string; url: string; value: unknown; undefined?: true }> {
  const wc = tab.webContents
  const res = await cdp<{
    result?: { type?: string; value?: unknown; description?: string }
    exceptionDetails?: { text?: string; exception?: { description?: string } }
  }>(wc, "Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: opts.awaitPromise !== false,
    userGesture: true,
  })
  if (res.exceptionDetails) {
    const detail = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "evaluation error"
    throw new Error(`EVAL_ERROR: ${detail}`)
  }
  const isUndefined = res.result?.type === "undefined"
  return {
    id: tab.id,
    url: wc.getURL(),
    value: isUndefined ? null : (res.result?.value ?? null),
    ...(isUndefined ? { undefined: true as const } : {}),
  }
}

async function resolveTargetObjectId(
  tab: AutomationTab,
  target: { readonly ref?: string; readonly selector?: string },
): Promise<string> {
  const wc = tab.webContents
  if (target.ref) {
    const backendNodeId = tab.refs.get(target.ref)
    if (backendNodeId === undefined) {
      throw new Error(`unknown ref "${target.ref}" — run snap first`)
    }
    await cdp(wc, "DOM.enable")
    const resolved = await cdp<{ object?: { objectId?: string } }>(wc, "DOM.resolveNode", { backendNodeId })
    if (!resolved.object?.objectId) throw new Error(`ref "${target.ref}" is no longer in the DOM`)
    return resolved.object.objectId
  }
  if (target.selector) {
    const res = await cdp<{ result?: { objectId?: string; subtype?: string } }>(wc, "Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(target.selector)})`,
      returnByValue: false,
    })
    if (!res.result?.objectId || res.result.subtype === "null") {
      throw new Error(`selector not found: ${target.selector}`)
    }
    return res.result.objectId
  }
  throw new Error("step requires either ref (@eN) or selector")
}

async function callOnObject<T = unknown>(
  wc: WebContents,
  objectId: string,
  functionDeclaration: string,
  args: readonly unknown[] = [],
): Promise<T> {
  const res = await cdp<{
    result?: { value?: T }
    exceptionDetails?: { text?: string; exception?: { description?: string } }
  }>(wc, "Runtime.callFunctionOn", {
    objectId,
    functionDeclaration,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  })
  if (res.exceptionDetails) {
    const detail = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "DOM action failed"
    throw new Error(detail)
  }
  return res.result?.value as T
}

async function centerPoint(wc: WebContents, objectId: string): Promise<{ x: number; y: number } | null> {
  return callOnObject<{ x: number; y: number } | null>(
    wc,
    objectId,
    `function() {
      if (typeof this.scrollIntoView === "function") this.scrollIntoView({ block: "center", inline: "center" });
      if (typeof this.getBoundingClientRect !== "function") return null;
      const r = this.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }`,
  )
}

async function dispatchMouseClick(wc: WebContents, x: number, y: number): Promise<void> {
  await cdp(wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", clickCount: 0 })
  await cdp(wc, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
  await cdp(wc, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
}

async function dispatchKey(wc: WebContents, rawKey: string): Promise<void> {
  const mapped = KEY_CODES[rawKey] ?? {
    key: rawKey,
    code: rawKey.length === 1 ? `Key${rawKey.toUpperCase()}` : rawKey,
    vk: rawKey.length === 1 ? rawKey.toUpperCase().charCodeAt(0) : 0,
    ...(rawKey.length === 1 ? { text: rawKey } : {}),
  }
  await cdp(wc, "Input.dispatchKeyEvent", {
    type: mapped.text ? "keyDown" : "rawKeyDown",
    key: mapped.key,
    code: mapped.code,
    windowsVirtualKeyCode: mapped.vk,
    nativeVirtualKeyCode: mapped.vk,
    ...(mapped.text ? { text: mapped.text, unmodifiedText: mapped.text } : {}),
  })
  await cdp(wc, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: mapped.key,
    code: mapped.code,
    windowsVirtualKeyCode: mapped.vk,
    nativeVirtualKeyCode: mapped.vk,
  })
}

async function waitForCondition(
  wc: WebContents,
  opts: { readonly selector?: string; readonly text?: string; readonly timeoutMs: number },
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs
  while (Date.now() < deadline) {
    const check = opts.selector
      ? `Boolean(document.querySelector(${JSON.stringify(opts.selector)}))`
      : `Boolean(document.body && document.body.innerText.includes(${JSON.stringify(opts.text ?? "")}))`
    const res = await cdp<{ result?: { value?: unknown } }>(wc, "Runtime.evaluate", {
      expression: check,
      returnByValue: true,
    })
    if (res.result?.value === true) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`wait timed out after ${opts.timeoutMs}ms (${opts.selector ?? opts.text ?? ""})`)
}

/** Run a sequence of browser automation steps in one IPC call. */
export async function batchTab(
  tab: AutomationTab,
  steps: readonly BatchStep[],
  opts: { readonly bridgeOrigin: string | null },
): Promise<BatchResult> {
  const wc = tab.webContents
  const results: BatchStepResult[] = []
  let allOk = true

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    try {
      let value: unknown
      switch (step.action) {
        case "nav":
          await navigateContents(wc, step.url, { bridgeOrigin: opts.bridgeOrigin, waitUntil: step.waitUntil })
          value = { url: wc.getURL(), title: wc.getTitle() }
          break
        case "click": {
          const objectId = await resolveTargetObjectId(tab, step)
          if (tab.visible) {
            const pt = await centerPoint(wc, objectId)
            if (pt) await dispatchMouseClick(wc, pt.x, pt.y)
            else await callOnObject(wc, objectId, "function() { this.click(); }")
          } else {
            // Detached background tabs do not receive OS mouse hit-testing; click via DOM with userGesture.
            await callOnObject(wc, objectId, "function() { this.scrollIntoView?.({ block: 'center' }); this.click(); }")
          }
          break
        }
        case "hover": {
          const objectId = await resolveTargetObjectId(tab, step)
          const pt = await centerPoint(wc, objectId)
          if (!pt) throw new Error("target element has no visible box to hover")
          await cdp(wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "none" })
          break
        }
        case "focus": {
          const objectId = await resolveTargetObjectId(tab, step)
          await callOnObject(wc, objectId, "function() { this.focus(); }")
          break
        }
        case "fill": {
          const objectId = await resolveTargetObjectId(tab, step)
          // Use the prototype value setter so React/Vue controlled inputs observe the change.
          await callOnObject(
            wc,
            objectId,
            `function(val) {
              this.focus();
              if (this.isContentEditable) {
                this.textContent = val;
              } else {
                const proto = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
                if (setter) setter.call(this, val);
                else this.value = val;
              }
              this.dispatchEvent(new Event("input", { bubbles: true }));
              this.dispatchEvent(new Event("change", { bubbles: true }));
            }`,
            [step.value],
          )
          break
        }
        case "type": {
          if (step.ref || step.selector) {
            const objectId = await resolveTargetObjectId(tab, step)
            await callOnObject(wc, objectId, "function() { this.focus(); }")
          }
          await cdp(wc, "Input.insertText", { text: step.text })
          break
        }
        case "press": {
          if (step.ref || step.selector) {
            const objectId = await resolveTargetObjectId(tab, step)
            await callOnObject(wc, objectId, "function() { this.focus(); }")
          }
          await dispatchKey(wc, step.key)
          break
        }
        case "select": {
          const objectId = await resolveTargetObjectId(tab, step)
          await callOnObject(
            wc,
            objectId,
            `function(val) {
              this.value = val;
              this.dispatchEvent(new Event("input", { bubbles: true }));
              this.dispatchEvent(new Event("change", { bubbles: true }));
            }`,
            [step.value],
          )
          break
        }
        case "check": {
          const objectId = await resolveTargetObjectId(tab, step)
          const want = step.checked ?? true
          await callOnObject(
            wc,
            objectId,
            `function(want) {
              if (Boolean(this.checked) !== want) this.click();
            }`,
            [want],
          )
          break
        }
        case "scroll": {
          if (step.ref || step.selector) {
            const objectId = await resolveTargetObjectId(tab, step)
            await callOnObject(
              wc,
              objectId,
              `function() { this.scrollIntoView({ block: "center", inline: "center" }); }`,
            )
          } else {
            await evalTab(tab, `window.scrollBy(${Number(step.x ?? 0)}, ${Number(step.y ?? 400)})`)
          }
          break
        }
        case "wait": {
          const timeoutMs = Math.min(MAX_WAIT_TIMEOUT_MS, Math.max(100, step.timeout ?? DEFAULT_WAIT_TIMEOUT_MS))
          if (step.selector || step.text) {
            await waitForCondition(wc, { selector: step.selector, text: step.text, timeoutMs })
          } else {
            const ms = Math.min(MAX_WAIT_TIMEOUT_MS, Math.max(0, step.ms ?? 250))
            await new Promise((r) => setTimeout(r, ms))
          }
          break
        }
        case "eval":
          value = (await evalTab(tab, step.expr)).value
          break
        case "snap":
          value = await snapTab(tab, { interactive: step.interactive, root: step.root, maxNodes: step.maxNodes })
          break
      }
      results.push({ index: i, action: step.action, ok: true, ...(value !== undefined ? { value } : {}) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({ index: i, action: step.action, ok: false, error: message })
      if (!step.optional) {
        allOk = false
        break
      }
    }
  }

  return {
    id: tab.id,
    url: wc.getURL(),
    title: wc.getTitle(),
    ok: allOk,
    completed: results.filter((r) => r.ok).length,
    total: steps.length,
    results,
  }
}

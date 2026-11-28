/** Runs one manifest entry's steps on a page and decides when the page is still enough to shoot. */

import type { Page } from "@playwright/test"
import { en, zh } from "../../../rove-web/src/i18n/index.ts"
import type { Step, Target } from "./manifest.ts"

export type Locale = "en" | "zh"

function lookup(locale: Locale, key: string): string {
  let node: unknown = locale === "zh" ? zh : en
  for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== "string") throw new Error(`no i18n key ${key}`)
  // A `{placeholder}` is matched as a prefix: everything before it.
  return node.split("{")[0]!.trim()
}

/** The centre of the topmost visible element the target names, or null. */
async function locate(page: Page, target: Target, locale: Locale): Promise<[number, number] | null> {
  const spec: { css?: string; text?: string; byLabel?: true } =
    typeof target === "string"
      ? { text: target }
      : "t" in target
        ? { text: lookup(locale, target.t) }
        : "css" in target
          ? { css: target.css }
          : { text: target.label, byLabel: true }
  return page.evaluate((spec) => {
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"
    }
    let found: Element | undefined
    if (spec.css) found = [...document.querySelectorAll(spec.css)].filter(visible).at(-1)
    else {
      const text = spec.text ?? ""
      const pool = [
        ...document.querySelectorAll(
          "button,a,input,textarea,[role=button],[role=menuitem],[role=menuitemradio],[role=option],[role=tab],[role=radio],[role=switch],label,summary,li,[data-row],[data-issue],[tabindex]",
        ),
      ].filter(visible)
      const name = (e: Element) => ((e as HTMLElement).innerText ?? "").trim().replace(/\s+/g, " ")
      const aria = (e: Element) => e.getAttribute("aria-label") ?? e.getAttribute("title") ?? ""
      // A menu or dialog floats over the page: its entry wins over a same-named one underneath (a project in the
      // composer's menu over the project's sidebar header).
      const floating = (e: Element) => {
        for (let a: Element | null = e; a; a = a.parentElement) {
          const st = getComputedStyle(a)
          if (st.position === "fixed" || (st.position === "absolute" && st.zIndex !== "auto" && Number(st.zIndex) > 0)) return true
        }
        return false
      }
      const score = (e: Element) => {
        const exact = spec.byLabel ? aria(e) === text : name(e) === text || aria(e) === text
        const prefix = !spec.byLabel && (name(e).startsWith(text) || aria(e).startsWith(text))
        return exact || prefix ? (floating(e) ? 2 : 0) + (exact ? 1 : 0) + 1 : 0
      }
      let best = 0
      for (const e of pool) {
        const s = score(e)
        if (s >= best && s > 0) [best, found] = [s, e]
      }
    }
    if (!found) return null
    found.scrollIntoView({ block: "nearest" })
    const r = found.getBoundingClientRect()
    return [r.x + r.width / 2, r.y + r.height / 2] as [number, number]
  }, spec)
}

const STEP_MS = 8000

/** Polls until the target shows up: a click waits for what it clicks, never a fixed delay. */
async function waitLocate(page: Page, target: Target, locale: Locale): Promise<[number, number]> {
  const end = Date.now() + STEP_MS
  for (;;) {
    const at = await locate(page, target, locale)
    if (at) return at
    if (Date.now() > end) throw new Error(`not found: ${JSON.stringify(target)}`)
    await page.waitForTimeout(100)
  }
}

export async function runSteps(page: Page, steps: readonly Step[], locale: Locale, touch: boolean): Promise<void> {
  for (const step of steps) {
    if ("click" in step) {
      const [x, y] = await waitLocate(page, step.click, locale)
      if (touch) await page.touchscreen.tap(x, y)
      else await page.mouse.click(x, y)
    } else if ("right" in step) {
      const [x, y] = await waitLocate(page, step.right, locale)
      if (touch) await longPress(page, x, y)
      else await page.mouse.click(x, y, { button: "right" })
    } else if ("hover" in step) {
      const [x, y] = await waitLocate(page, step.hover, locale)
      await page.mouse.move(x, y)
    } else if ("wait" in step) await waitLocate(page, step.wait, locale)
    else if ("press" in step) await (step.on ? page.locator(step.on).first().press(step.press) : page.keyboard.press(step.press))
    else if ("type" in step) await page.keyboard.type(step.type)
  }
}

/** A long-press is a touch held: CDP's touch events on one session, as a finger does it. */
async function longPress(page: Page, x: number, y: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
  await page.waitForTimeout(700)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await cdp.detach()
}

const QUIET_MS = 300
const wire = new WeakMap<Page, () => number>()

/** Notes when the page last heard from or wrote to its bridge's WebSocket. Call before the page loads. */
export function trackWire(page: Page): void {
  if (wire.has(page)) return
  let last = Date.now()
  page.on("websocket", (ws) => {
    ws.on("framereceived", () => (last = Date.now()))
    ws.on("framesent", () => (last = Date.now()))
  })
  wire.set(page, () => last)
}

/**
 * Still enough to shoot: fonts loaded, the bridge quiet for a moment, then two captures in a row identical. A blinking terminal cursor would never
 * settle, so an unfocused one is asked for first (it draws hollow and still).
 */
export async function settle(page: Page, capture: () => Promise<Buffer>): Promise<Buffer> {
  await page.evaluate(async () => {
    await document.fonts.ready
    const el = document.activeElement as HTMLElement | null
    if (el?.closest(".xterm")) el.blur()
  })
  // Replies still on the wire (a skill check, a diff) would land after the shot.
  const quietSince = wire.get(page)
  for (let i = 0; quietSince && Date.now() - quietSince() < QUIET_MS && i < 40; i++) await page.waitForTimeout(QUIET_MS / 2)
  let last = await capture()
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const next = await capture()
    if (next.equals(last)) return next
    last = next
  }
  return last
}

/** Scrolls the page's biggest scroller (Settings sections, long lists) to its `n`th screenful; false past the end. */
export async function scrollTo(page: Page, n: number): Promise<boolean> {
  return page.evaluate((n) => {
    const els = [...document.querySelectorAll("*")].filter((e) => {
      const st = getComputedStyle(e)
      return /(auto|scroll)/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 20 && e.clientWidth > 300 && !e.closest(".xterm")
    })
    els.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)
    const el = els[0]
    if (!el) return false
    const step = Math.round(el.clientHeight * 0.85)
    if (n > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) return false
    el.scrollTop = step * n
    return true
  }, n)
}

/**
 * Input helpers every storyboard (films and stills) drives the TUI with.
 *
 * A storyboard file is then only its beats: what to click, what to type, and
 * how long to hold on each. Everything below is the part that must not drift
 * between two takes of the same product.
 */

import { resolve } from "node:path"
import type { Page } from "@playwright/test"

export const REPO_ROOT: string = resolve(import.meta.dirname, "../../..")

const KEYS: Record<string, string> = {
  enter: "Enter",
  esc: "Escape",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  tab: "Tab",
  // Playwright names function keys uppercase; the atlas drives F1 (help) and
  // F2/F3/F4 (rename, focus split, cycle focus), which lowercase chords miss.
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i + 1}`, `F${i + 1}`])),
}
const MODS: Record<string, string> = { ctrl: "Control", alt: "Alt", shift: "Shift" }

function chord(token: string): string {
  const parts = token.toLowerCase().split("+")
  const key = parts.pop() ?? ""
  return [...parts.map((part) => MODS[part] ?? part), KEYS[key] ?? key].join("+")
}

export async function press(page: Page, ...tokens: string[]): Promise<void> {
  for (const token of tokens) {
    await page.keyboard.press(chord(token))
    await page.waitForTimeout(400)
  }
}

/**
 * Pane switching is done by CLICKING the row, not by the `ctrl+a` prefix.
 * The prefix is a two-stroke sequence, and while an engine is streaming into
 * the pane the second stroke gets starved: two takes were lost to a storyboard
 * that thought it had moved to the sidebar and typed its whole navigation —
 * `kkkkjjjl` — into a chat composer. A click cannot half-happen.
 */
export async function click(page: Page, x: number, y: number): Promise<void> {
  await page.getByTestId("opentui-terminal").click({ position: { x, y } })
  await page.waitForTimeout(800)
}

/** The 12px harness font's cell at DPR 1. */
const CELL = { width: 7, height: 16 } as const

/**
 * Click the first on-screen occurrence of `needle` at or right of column
 * `minCol`, found in the buffer mirror. Rows are never pixel constants: one
 * sidebar row added above shifts every hard-coded y onto its neighbour, and
 * the take films the wrong page with nothing failing.
 *
 * `nth` picks a later match when several rows share the text (sibling tasks
 * with one title); `below` clicks that many rows under the match — the chat
 * tab nested under a task has no text of its own to find.
 */
export async function clickText(
  page: Page,
  needle: string,
  minCol = 0,
  { nth = 0, below = 0 }: { nth?: number; below?: number } = {},
): Promise<void> {
  const hit = await page.getByTestId("opentui-buffer").evaluate(
    (el, [text, min, skip]) => {
      const lines = (el.textContent ?? "").split("\n")
      let seen = 0
      for (const [row, line] of lines.entries()) {
        const col = line.indexOf(text as string, min as number)
        if (col < 0) continue
        if (seen === skip) return { row, col }
        seen += 1
      }
      return null
    },
    [needle, minCol, nth] as const,
  )
  if (!hit) throw new Error(`no ${JSON.stringify(needle)} (match ${nth}) on screen right of column ${minCol}`)
  await click(page, (hit.col + 1) * CELL.width, (hit.row + below) * CELL.height + CELL.height / 2)
}

/**
 * Type text and PROVE it landed. Keystrokes are delivered into a live xterm
 * that may be rendering another session's output, and a burst gets truncated
 * mid-word — the first README take froze on a half-typed prompt that was never
 * submitted. So: type slowly, read it back out of the buffer, and retype once
 * from a cleared line if the tail is missing.
 */
export async function type(page: Page, text: string, clear = "ctrl+u"): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.keyboard.type(text, { delay: 80 })
    await page.waitForTimeout(900)
    if (await look(page, text.slice(-14), 5_000)) return
    await press(page, clear)
  }
  console.error(`[hero:capture] text never echoed: ${JSON.stringify(text)}`)
}

/** Advisory wait: returns false instead of failing the whole recording. */
export async function look(page: Page, needle: string, timeout = 60_000): Promise<boolean> {
  const buffer = await page.getByTestId("opentui-buffer").elementHandle()
  try {
    await page.waitForFunction(
      ([el, text]) => (el as Element | null)?.textContent?.includes(text as string) ?? false,
      [buffer, needle] as const,
      { timeout },
    )
    return true
  } catch {
    console.error(`[hero:capture] never saw ${JSON.stringify(needle)} — moving on`)
    return false
  }
}

/**
 * Wait for `needle` to LEAVE the buffer. The mirror of {@link look}, for the
 * case a storyboard actually has: filming a turn until it finishes.
 *
 * Waiting a fixed number of seconds cannot do this — a turn takes as long as
 * it takes, and a hold long enough for the slow case films the fast one
 * sitting still. The README demo shipped with roughly half its runtime frozen
 * on a finished turn for exactly that reason. Advisory like `look`: a timeout
 * returns false rather than failing the take.
 */
export async function gone(page: Page, needle: string, timeout = 180_000): Promise<boolean> {
  const buffer = await page.getByTestId("opentui-buffer").elementHandle()
  try {
    await page.waitForFunction(
      ([el, text]) => !((el as Element | null)?.textContent?.includes(text as string) ?? false),
      [buffer, needle] as const,
      { timeout, polling: 1_000 },
    )
    return true
  } catch {
    console.error(`[hero:capture] ${JSON.stringify(needle)} never cleared — moving on`)
    return false
  }
}

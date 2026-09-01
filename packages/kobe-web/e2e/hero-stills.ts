/**
 * `bun e2e/hero-stills.ts [name…]` — the docs STILLS, as a script rather than
 * as shell history.
 *
 * Only `workspace.png` was ever written down (in `HARNESS.md`); the rest lived
 * as ad-hoc `hero-shot.ts` invocations, so re-shooting them meant reverse-
 * engineering the keystrokes from the images. Each entry below is one asset:
 * where it navigates, what viewport it needs, and what it is OF.
 *
 * Requires `hero-serve.ts`, a fixture (`hero-fixture.ts`), the kanban board
 * (`hero-issues.ts`), and — for `workspace` — real engine sessions
 * (`hero-seed.ts`). Read-only: no still creates a record, so unlike the video
 * storyboards these are idempotent.
 */

import { join, resolve } from "node:path"
import { chromium } from "@playwright/test"
import { HERO_PTY_PORT, HERO_WEB_PORT } from "./hero-env.ts"

const REPO_ROOT = resolve(import.meta.dirname, "../../..")
const ASSETS = join(REPO_ROOT, "docs", "assets")

/** Sidebar row centres at 1280×800 — shared with the video storyboards. */
/**
 * Sidebar row centres at 1280×800. `seededTab` is the CHAT TAB nested under a
 * seeded task, not the task row: clicking the task selects it but leaves the
 * pane on whatever tab was last focused, which is how this still first came
 * back showing an empty composer.
 */
const ROW = { kanban: 87, routines: 104, main: 152, seededTab: 264 } as const

type Still = {
  readonly name: string
  readonly width?: number
  readonly height?: number
  /** Device pixel ratio; see {@link STILL_SCALE} before raising this. */
  readonly scale?: number
  /** What the reader is meant to see — kept next to the keystrokes. */
  readonly subject: string
  readonly drive: (page: Page) => Promise<void>
}

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>

/**
 * Device pixel ratio for every still — deliberately 1, not 2.
 *
 * `--scale` is supposed to raise only the raster density while the viewport,
 * and so the terminal's cell grid, stays fixed. It no longer does: at 2 the
 * TUI comes back one column wide, with a larger glyph and the right pane cut
 * off, while the same command produced a correct three-pane frame for the
 * images currently in `docs/assets`. Something in the DPR path now feeds the
 * fit calculation, so a 2× still photographs a DIFFERENT layout rather than a
 * sharper one.
 *
 * Until that is fixed these ship at 1×: lower density than the images they
 * replace, but showing the product as it actually lays out. Raise this back to
 * 2 in the same change that fixes the regression, never before.
 */
const STILL_SCALE = 1

const KEYS: Record<string, string> = {
  enter: "Enter",
  esc: "Escape",
  tab: "Tab",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
}
const MODS: Record<string, string> = { ctrl: "Control", alt: "Alt", shift: "Shift" }

async function press(page: Page, ...tokens: string[]): Promise<void> {
  for (const token of tokens) {
    const parts = token.toLowerCase().split("+")
    const key = parts.pop() ?? ""
    await page.keyboard.press([...parts.map((p) => MODS[p] ?? p), KEYS[key] ?? key].join("+"))
    await page.waitForTimeout(400)
  }
}

async function click(page: Page, x: number, y: number): Promise<void> {
  await page.getByTestId("opentui-terminal").click({ position: { x, y } })
  await page.waitForTimeout(800)
}

async function look(page: Page, needle: string, timeout = 20_000): Promise<void> {
  const buffer = await page.getByTestId("opentui-buffer").elementHandle()
  try {
    await page.waitForFunction(
      ([el, text]) => (el as Element | null)?.textContent?.includes(text as string) ?? false,
      [buffer, needle] as const,
      { timeout },
    )
  } catch {
    console.error(`[hero:stills] never saw ${JSON.stringify(needle)} — shooting anyway`)
  }
}

const STILLS: readonly Still[] = [
  {
    name: "workspace",
    subject: "the three panes: tasks, the live engine session, changed files",
    drive: async (page) => {
      // Three panes IS the default layout — it just needs a task whose engine
      // has something in it, so the middle pane holds a transcript rather than
      // the empty-state line. `HARNESS.md` documented `ctrl+a l` for this,
      // which now focuses a pane rather than arranging one: it lands in zen
      // mode and photographs a SINGLE column, contradicting the caption.
      // Clicking a seeded task is what the reader would do anyway.
      await click(page, 40, ROW.seededTab)
      await look(page, "Worked for")
      await page.waitForTimeout(3_000)
    },
  },
  {
    name: "kanban",
    subject: "Backlog / In progress / Done with the cursor on an in-progress story",
    drive: async (page) => {
      await click(page, 40, ROW.kanban)
      await look(page, "In progress")
      await page.waitForTimeout(1_200)
      // The board opens with NO card selected (`selectedId` starts null), so
      // the caption's "cursor on a story" needs a keypress to exist. `down`
      // takes the first card of the leftmost column (Backlog); `right` moves
      // to In progress, which is the column the caption names.
      await press(page, "down")
      await page.waitForTimeout(600)
      await press(page, "right")
      await page.waitForTimeout(1_500)
    },
  },
  {
    name: "kanban-story",
    subject: "the story drawer: editable fields above the engine/workspace choices",
    drive: async (page) => {
      await click(page, 40, ROW.kanban)
      await look(page, "In progress")
      await page.waitForTimeout(1_200)
      // `enter` on an unselected board is a no-op — it photographed the plain
      // board twice before this. Select a card first.
      await press(page, "down")
      await page.waitForTimeout(800)
      await press(page, "enter")
      await look(page, "WORKSPACE")
      await page.waitForTimeout(2_000)
    },
  },
  {
    name: "routines",
    height: 560,
    subject: "three scheduled prompts with next-run times and the selected one's detail",
    drive: async (page) => {
      await click(page, 40, ROW.routines)
      await look(page, "Nightly dependency audit")
      await page.waitForTimeout(2_000)
    },
  },
  {
    name: "routines-composer",
    height: 560,
    subject: "the New routine composer with the hour cell selected and the schedule restated",
    drive: async (page) => {
      await click(page, 40, ROW.routines)
      await look(page, "Nightly dependency audit")
      await page.waitForTimeout(1_000)
      await press(page, "n")
      await look(page, "New routine")
      await page.waitForTimeout(800)
      // Fill name and prompt: an all-placeholder card photographs as an empty
      // form, and the caption describes a composed routine.
      await page.keyboard.type("Weekday dependency audit", { delay: 30 })
      await page.waitForTimeout(500)
      await press(page, "tab") // → repo
      await press(page, "tab") // → prompt
      await page.keyboard.type("Audit dependencies and summarize risky changes.", { delay: 30 })
      await page.waitForTimeout(500)
      // → schedule, then the hour cell, which is what the caption describes;
      // the preview underneath restates the whole cron in words.
      await press(page, "tab")
      await page.waitForTimeout(600)
      await press(page, "right")
      await page.waitForTimeout(1_800)
    },
  },
]

const args = process.argv.slice(2)
const selected = args.filter((arg) => !arg.startsWith("--"))
const queue = selected.length > 0 ? STILLS.filter((s) => selected.includes(s.name)) : STILLS
if (queue.length === 0) throw new Error(`no such still: ${selected.join(", ")}`)

const browser = await chromium.launch({ headless: true })
try {
  for (const still of queue) {
    const width = still.width ?? 1280
    const height = still.height ?? 800
    const runId = `still-${still.name}-${queue.indexOf(still)}`
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: still.scale ?? STILL_SCALE,
    })
    // `webgl=1` for the same reason recordings use it: the DOM renderer cannot
    // use xterm's `customGlyphs`, so block-element and box-drawing characters
    // (pane borders, engine banner art) photograph with a seam at every cell
    // boundary. A failed context falls back to DOM inside ChatTerminal.
    await page.goto(`http://localhost:${HERO_WEB_PORT}/harness?run=${runId}&webgl=1`)
    await page.getByTestId("opentui-harness").waitFor({ timeout: 15_000 })
    await look(page, "orbit-sdk", 60_000)
    await page.getByTestId("opentui-terminal").click({ position: { x: 24, y: Math.min(400, height - 80) } })
    await page.waitForTimeout(2_000)
    await still.drive(page)
    const out = join(ASSETS, `${still.name}.png`)
    await page.screenshot({ path: out })
    await page.request
      .post(`http://127.0.0.1:${HERO_PTY_PORT}/pty/close`, { data: { tab: `visual-${runId}` } })
      .catch(() => {})
    await page.close()
    console.log(`${out}  — ${still.subject}`)
  }
} finally {
  await browser.close()
}

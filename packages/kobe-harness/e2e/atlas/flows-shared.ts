/**
 * Shared vocabulary for the atlas flow files (`flows-work`, `flows-plan`,
 * `flows-nav`), which `flows.ts` re-exports as one ordered list.
 *
 * The TUI atlas: every reachable surface, as a list of FLOWS, each flow a list
 * of STEPS. One step = one screenshot. A flow is one user journey through the
 * product; its steps are what the screen looks like at each keystroke along it.
 *
 * This is the map, kept separate from the runner so adding a surface means
 * adding data, not code. Steps are cumulative within a flow — step N runs after
 * step N-1's keys, on the same page — and every flow starts from a fresh
 * `/harness` boot focused on the sidebar.
 */

import { click, look, type as typeText } from "../hero-capture.ts"

const KEYS: Record<string, string> = {
  enter: "Enter",
  esc: "Escape",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  tab: "Tab",
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i + 1}`, `F${i + 1}`])),
}
const MODS: Record<string, string> = { ctrl: "Control", alt: "Alt", shift: "Shift" }

/** Derived from `click`, not `press`: `press` is local now and would be circular. */
type Page = Parameters<typeof click>[0]

/**
 * Atlas key presses, at a shorter settle than the shared `press`.
 *
 * `hero-capture.press` waits a flat 400ms per token because the VIDEO takes
 * need every keystroke visible on camera. A still only needs the frame to be
 * correct when it is finally taken, and each step already ends with its own
 * explicit wait — so the per-token settle is pure overhead here, ~19s of a
 * 398s run across 47 press() calls.
 *
 * Kept as a separate function rather than a parameter on the shared one: the
 * recorders' timing is load-bearing for the demo, and this must not be able to
 * change it.
 */
const ATLAS_SETTLE_MS = 150

export async function press(page: Page, ...tokens: string[]): Promise<void> {
  for (const token of tokens) {
    const parts = token.toLowerCase().split("+")
    const key = parts.pop() ?? ""
    await page.keyboard.press([...parts.map((p) => MODS[p] ?? p), KEYS[key] ?? key].join("+"))
    await page.waitForTimeout(ATLAS_SETTLE_MS)
  }
}

// Re-exported so a flow file imports its whole vocabulary from one place.
export { click, look, typeText }


/** Sidebar row centres at 1280×800, shared with the stills + video storyboards. */
export const ROW = { kanban: 87, routines: 104, project: 136, main: 152, seededTab: 264 } as const

export type Step = {
  /** File-name suffix; `<flow>-<n>-<name>.png`. */
  readonly name: string
  /** What a reviewer is meant to judge in this frame. */
  readonly subject: string
  readonly drive: (page: Page) => Promise<void>
}

export type Flow = {
  readonly name: string
  /** One line on the atlas: what journey this is. */
  readonly summary: string
  readonly width?: number
  readonly height?: number
  readonly steps: readonly Step[]
}

/**
 * Put focus in the SIDEBAR — the start of most journeys.
 *
 * Clicking a row is not enough: opening a task moves focus to its engine pane,
 * so every sidebar-scoped key after the click (`x`, `n`, `/`, `r`) lands in the
 * chat composer instead. The first atlas run photographed exactly that — a
 * composer reading `xnAdd a retry helper…` where a Worktrees page should have
 * been. `ctrl+q` focuses the sidebar too but is NOT idempotent (a second press
 * quits), so pane-left is the only safe primitive.
 *
 * `ctrl+u` first clears any composer debris a previous step typed.
 */
export async function intoSidebar(page: Page): Promise<void> {
  await click(page, 40, ROW.main)
  await press(page, "ctrl+u")
  await press(page, "ctrl+a", "h")
  // The prefix HUD lingers after the sequence resolves, and a chord pressed
  // while it is up is swallowed — `ctrl+e` photographed a plain workspace with
  // the footer still reading `ctrl+a + h → Focus`. Wait it out.
  await page.waitForTimeout(1_500)
}


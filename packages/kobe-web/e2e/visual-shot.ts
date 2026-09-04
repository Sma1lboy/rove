/**
 * `bun run visual:shot [--out=path] [--scale=N] [token…]` — one ad-hoc
 * screenshot of the real OpenTUI through the warm harness (`visual:serve`
 * must be running). Tokens are applied in order: `text:…` types literally,
 * `wait:<ms>` pauses (for a beat that needs an engine to finish working),
 * everything else is a key chord (`ctrl+h`, `c`, `enter`, `down`…). No tokens
 * = the start view. `--scale` sets the device pixel ratio — the viewport stays
 * 1280×800 so the TUI keeps its cell grid, only the raster gets denser, which
 * is what a docs/README asset needs (`--scale=2` → a 2560×1600 PNG).
 *
 *   bun run visual:shot -- ctrl+a c            # Kanban board (prefix chord)
 *   bun run visual:shot -- ctrl+a c n "text:Draft title"
 *   bun run visual:shot -- --scale=2 --out=docs/assets/workspace.png
 *   bun run visual:shot -- --hostbg=#FFFFFF    # simulated light host terminal
 *   bun run visual:shot -- --width=340 --height=400          # narrow layout
 *   bun run visual:shot -- --wallpaper=/wallpaper.svg ctrl+pageup  # transparent
 *   bun run visual:shot -- click:29,56         # a row the keyboard can't reach
 *   bun run visual:shot -- rclick:29,140       # that row's context menu
 */

import { resolve } from "node:path"
import { chromium } from "@playwright/test"
import { fixtureAuthHeaders, VISUAL_PTY_PORT, VISUAL_WEB_PORT } from "./visual-fixture.ts"

const KEY_NAMES: Record<string, string> = {
  enter: "Enter",
  return: "Enter",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  space: "Space",
  backspace: "Backspace",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  // Playwright is case-sensitive here; the generic capitalize below would
  // produce "Pageup"/"Pagedown", which it rejects outright.
  pageup: "PageUp",
  pagedown: "PageDown",
  pgup: "PageUp",
  pgdn: "PageDown",
  home: "Home",
  end: "End",
  delete: "Delete",
  del: "Delete",
}
const MODIFIERS: Record<string, string> = { ctrl: "Control", alt: "Alt", shift: "Shift", cmd: "Meta", meta: "Meta" }

function chord(token: string): string {
  const parts = token.toLowerCase().split("+")
  const key = parts.pop() ?? ""
  const mods = parts.map((part) => MODIFIERS[part] ?? part)
  return [...mods, KEY_NAMES[key] ?? (key.length === 1 ? key : key.charAt(0).toUpperCase() + key.slice(1))].join("+")
}

const args = process.argv.slice(2)
const outArg = args.find((arg) => arg.startsWith("--out="))?.slice(6)
const out = resolve(outArg ?? "test-results/visual-shot.png")
const scaleArg = args.find((arg) => arg.startsWith("--scale="))?.slice(8)
const deviceScaleFactor = scaleArg === undefined ? 1 : Number(scaleArg)
if (!Number.isFinite(deviceScaleFactor) || deviceScaleFactor <= 0) {
  throw new Error(`--scale must be a positive number, got ${JSON.stringify(scaleArg)}`)
}
// `--hostbg=#rrggbb` simulates a host terminal with that background color
// (light-theme terminal being the contrast worst case) — the harness paints
// it behind the terminal AND makes xterm report it via OSC 11, so the TUI's
// transparent-mode contrast guard adapts through the real detection path.
const hostbgArg = args.find((arg) => arg.startsWith("--hostbg="))?.slice(9)
if (hostbgArg !== undefined && !/^#[0-9a-fA-F]{6}$/.test(hostbgArg)) {
  throw new Error(`--hostbg must be #rrggbb, got ${JSON.stringify(hostbgArg)}`)
}
// `--width`/`--height` override the 1280×800 default so a capture can cross
// the narrow-layout breakpoint (below ~70 cols the workspace collapses to one
// panel and the tab strip switches to its condensed form).
function dimension(flag: string, fallback: number): number {
  const raw = args.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive number, got ${JSON.stringify(raw)}`)
  return value
}
const width = dimension("--width", 1280)
const height = dimension("--height", 800)
// `--wallpaper=<url>` puts an image behind the harness so TRANSPARENT-mode
// captures show what actually bleeds through — a panel forced to alpha-0 is
// indistinguishable from an opaque one against a flat backdrop.
const wallpaper = args.find((arg) => arg.startsWith("--wallpaper="))?.slice(12)
const tokens = args.filter((arg) => !arg.startsWith("--"))
const runId = `shot-${Date.now()}`

const browser = await chromium.launch({ headless: true }).catch((error: unknown) => {
  throw new Error(`chromium launch failed: ${error instanceof Error ? error.message : String(error)}`)
})
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor })
  const hostbgQuery = hostbgArg ? `&hostbg=${encodeURIComponent(hostbgArg)}` : ""
  const wallpaperQuery = wallpaper ? `&wallpaper=${encodeURIComponent(wallpaper)}` : ""
  await page
    .goto(`http://localhost:${VISUAL_WEB_PORT}/harness?run=${runId}${hostbgQuery}${wallpaperQuery}`)
    .catch(() => {
      throw new Error(`no server on :${VISUAL_WEB_PORT} — start \`bun run visual:serve\` first`)
    })
  const harness = page.getByTestId("opentui-harness")
  await harness.waitFor({ timeout: 10_000 })
  // TUI takeover: the fixture project row is the workspace's earliest stable
  // marker (the tree sidebar, default since the worktree tree landed, never
  // prints the old PROJECTS header this script used to wait for).
  const buffer = page.getByTestId("opentui-buffer")
  await page.waitForFunction(
    (el) => el?.textContent?.includes("fixture-repo"),
    await buffer.elementHandle(),
    { timeout: 45_000 },
  )
  // Click the sidebar's EMPTY lower area — (24, 24) would land on the tree's
  // project header row (same re-anchor rationale as sandbox.spec.ts). The y
  // is element-relative, so it scales with --height: a fixed 400 falls
  // outside a short viewport and Playwright then retries the click forever.
  await page.getByTestId("opentui-terminal").click({ position: { x: 24, y: Math.floor(height / 2) } })
  for (const token of tokens) {
    if (token.startsWith("text:")) await page.keyboard.type(token.slice(5))
    else if (token.startsWith("wait:")) await page.waitForTimeout(Number(token.slice(5)))
    else if (token.startsWith("click:") || token.startsWith("rclick:")) {
      // `click:X,Y` — a raw viewport click, for a row the keyboard cannot
      // reach without first walking the tree cursor through it. `rclick:X,Y`
      // is the same with button 2, which is the ONLY way to photograph a
      // context menu: the menu has no chord, so a keyboard-driven shot can
      // never open one.
      const right = token.startsWith("rclick:")
      const [x, y] = token.slice(right ? 7 : 6).split(",").map(Number)
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error(`${right ? "rclick" : "click"}: needs X,Y, got ${JSON.stringify(token)}`)
      await page.mouse.click(x, y, right ? { button: "right" } : undefined)
    } else await page.keyboard.press(chord(token))
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(600)
  await page.screenshot({ path: out })
  await page.request
    .post(`http://127.0.0.1:${VISUAL_PTY_PORT}/pty/close`, { data: { tab: `visual-${runId}` }, headers: fixtureAuthHeaders() })
    .catch(() => {})
  console.log(out)
} finally {
  await browser.close()
}

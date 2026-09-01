/**
 * Shared driver for the hero VIDEO captures — the browser/PTY plumbing and
 * the ffmpeg encode that `hero-record.ts` (README demo) and `hero-kanban.ts`
 * (the kanban feature demo) both ride. Stills stay in `hero-shot.ts`.
 *
 * A storyboard file is then only its beats: what to click, what to type, and
 * how long to hold on each. Everything below is the part that must not drift
 * between two recordings of the same product.
 */

import { mkdir, readdir, rename } from "node:fs/promises"
import { join, resolve } from "node:path"
import { type Page, chromium } from "@playwright/test"
import { HERO_PTY_PORT, HERO_WEB_PORT } from "./hero-env.ts"

export const REPO_ROOT: string = resolve(import.meta.dirname, "../../..")
const BRANDING = join(REPO_ROOT, "packages", "branding")

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

/**
 * Boot a fresh `/harness` browser PTY against the warm hero stack, wait for
 * the TUI to take the terminal over, hand the page to `storyboard`, and leave
 * a `.webm` in `workDir`. The takeover marker is the hero repo's own sidebar
 * row: until it renders, keystrokes land in a shell, not in the product.
 */
/**
 * Text that must never reach a published asset.
 *
 * `HOME` stays the operator's throughout a hero capture (see `hero-env.ts`):
 * the engine under capture is the real `claude` and needs its credentials. The
 * cost is that some product surfaces render the operator's own account —
 * Settings → Engines lists every engine's detected login, e-mail address and
 * subscription included. A storyboard can wander onto such a page in one
 * keystroke, and a frame or two of it survives into an mp4 nobody re-watches
 * before publishing. This is the backstop for that: cheap, and it does not
 * depend on remembering.
 */
const FORBIDDEN = [/[\w.+-]+@[\w-]+\.[\w.]+/] as const

/**
 * Read the terminal buffer and fail the take if it is showing something that
 * must not be published. Called on a beat cadence during `record`, because a
 * check that only runs at the end cannot say WHICH beat exposed it.
 */
async function assertNothingSensitive(page: Page): Promise<void> {
  const text = (await page.getByTestId("opentui-buffer").textContent()) ?? ""
  for (const pattern of FORBIDDEN) {
    const hit = text.match(pattern)
    if (hit) {
      const at = text.indexOf(hit[0])
      const around = text.slice(Math.max(0, at - 120), at + 120).replace(/\s+/g, " ")
      throw new Error(
        `capture aborted: the TUI is displaying ${JSON.stringify(hit[0])} (…${around}…), which must not reach a published asset. ` +
          `Some beat navigated onto a surface that renders the operator's own account (Settings → Engines is the usual one). ` +
          `Re-route that beat; HOME is deliberately the operator's, so the page itself is not the bug.`,
      )
    }
  }
}

export async function record(workDir: string, storyboard: (page: Page) => Promise<void>): Promise<void> {
  const runId = `rec-${Date.now()}`
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: workDir, size: { width: 1280, height: 800 } },
  })
  try {
    const page = await context.newPage()
    // `webgl=1`: recordings need xterm's WebGL renderer, not the DOM one the
    // harness defaults to. The DOM renderer draws every cell as its own span
    // using the font, which disables `customGlyphs` — xterm's geometric
    // drawing of block-element and box-drawing characters. Engine banner art
    // is built from those (Claude Code's logo is `▛█▝▀`), so under DOM it
    // photographs with a seam down every cell boundary instead of the solid
    // shape a real terminal shows. Stills keep the DOM default: a WebGL
    // context is not guaranteed in every CI container, and a still that fails
    // to render is worse than one with a seam. A failed context falls back to
    // DOM inside ChatTerminal either way.
    // `HERO_CAPTURE_WALLPAPER` swaps the flat backdrop for a desktop wallpaper
    // showing through a transparent terminal, which is what makes a capture
    // read as a window rather than a rectangle. The renderer follows from that
    // choice (see ChatTerminal): transparent takes the canvas renderer, opaque
    // ones take WebGL. Both tile block-drawing glyphs without a seam; the DOM
    // renderer, which does not, is only ever the fallback.
    const wallpaper = process.env.HERO_CAPTURE_WALLPAPER
    const query = wallpaper
      ? `wallpaper=${encodeURIComponent(wallpaper)}`
      : "webgl=1"
    await page.goto(`http://localhost:${HERO_WEB_PORT}/harness?run=${runId}&${query}`)
    await page.getByTestId("opentui-harness").waitFor({ timeout: 15_000 })
    await look(page, "orbit-sdk", 60_000)
    await page.getByTestId("opentui-terminal").click({ position: { x: 24, y: 400 } })
    await page.waitForTimeout(2_000)
    let breach: Error | null = null
    const guard = setInterval(() => {
      void assertNothingSensitive(page).catch((error: Error) => {
        console.error(`[hero:capture] ${error.message}`)
        breach = error
      })
    }, 1_000)
    try {
      await storyboard(page)
    } finally {
      clearInterval(guard)
    }
    if (breach) throw breach
    await page.request.post(`http://127.0.0.1:${HERO_PTY_PORT}/pty/close`, { data: { tab: `visual-${runId}` } }).catch(() => {})
  } finally {
    await context.close()
    await browser.close()
  }
}

function ffmpeg(argv: readonly string[]): void {
  const proc = Bun.spawnSync(["bun", "x", "remotion", "ffmpeg", ...argv], {
    cwd: BRANDING,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (proc.exitCode !== 0) throw new Error(`ffmpeg failed: ${new TextDecoder().decode(proc.stderr).slice(-2000)}`)
}

/**
 * Encode the take in `workDir` to `<name>.mp4` + `<name>.gif` in `outDir`,
 * sped up `speed`× — real seconds per delivered second, because a live
 * session is minutes and a docs page is not.
 *
 * Encoding rides Remotion's bundled ffmpeg: the repo has no system ffmpeg,
 * and Playwright's build carries neither h264 nor the gif palette filters.
 * That build is also `--disable-filters` with a small whitelist, so the
 * speed-up is a TIMESTAMP rescale (`-itsscale`) and the gif frame rate is an
 * output `-r` — `setpts` and `fps` do not exist in it; `scale`, `palettegen`
 * and `paletteuse` do.
 */
export async function encode(opts: {
  readonly workDir: string
  readonly outDir: string
  readonly name: string
  readonly speed: number
  /** GIF width. A README gif autoplays inline, so it stays small. */
  readonly gifWidth?: number
  /**
   * Seconds to drop off the FRONT, in delivered (post-speed-up) time — the
   * take always opens on the harness settling into the TUI, and that frame
   * is also the video's poster. Output-side `-ss`, so it survives the
   * `-itsscale` rescale that stands in for the missing `setpts` filter.
   */
  readonly startAt?: number
}): Promise<void> {
  const recorded = (await readdir(opts.workDir)).find((file) => file.endsWith(".webm"))
  if (!recorded) throw new Error(`no video written to ${opts.workDir}`)
  const source = join(opts.workDir, `${opts.name}.webm`)
  if (recorded !== `${opts.name}.webm`) await rename(join(opts.workDir, recorded), source)

  await mkdir(opts.outDir, { recursive: true })
  const cut = ["-itsscale", String(1 / opts.speed)]
  const trim = opts.startAt ? ["-ss", String(opts.startAt)] : []
  const mp4 = join(opts.outDir, `${opts.name}.mp4`)
  ffmpeg([
    "-y",
    ...cut,
    "-i",
    source,
    ...trim,
    "-vf",
    "scale=1280:-2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "24",
    "-r",
    "24",
    "-movflags",
    "+faststart",
    mp4,
  ])

  const palette = join(opts.workDir, `${opts.name}-palette.png`)
  const gifScale = `scale=${opts.gifWidth ?? 800}:-1:flags=lanczos`
  const gif = join(opts.outDir, `${opts.name}.gif`)
  // No `trim` on this pass: palettegen emits a SINGLE frame, and an
  // output-side `-ss` discards it ("Output file is empty, nothing was
  // encoded") — the palette lands nowhere and the paletteuse pass below then
  // fails on a missing input. Sampling the whole take costs nothing: the
  // trimmed head is the same UI in the same colors.
  ffmpeg(["-y", ...cut, "-i", source, "-vf", `${gifScale},palettegen=max_colors=96`, "-update", "1", palette])
  ffmpeg([
    "-y",
    ...cut,
    "-i",
    source,
    "-i",
    palette,
    ...trim,
    "-lavfi",
    `[0:v]${gifScale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
    "-r",
    "10",
    "-loop",
    "0",
    gif,
  ])
  console.log(mp4)
  console.log(gif)
}

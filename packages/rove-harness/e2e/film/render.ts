/**
 * Render a film from its committed cast: `/harness?replay` on a private Vite,
 * one seek + screenshot per output frame, then encode. No PTY, daemon, engine
 * or fixture is involved, so the same cast and cut always give the same frames.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { gunzipSync } from "node:zlib"
import { type Browser, chromium, type Page } from "@playwright/test"
import type { CastMarker } from "../../src/lib/cast.ts"
import { REPO_ROOT } from "../hero-capture.ts"
import { encode, encodeClip } from "./encode.ts"
import { castPath, type Film, FPS, frameTimes, type Segment, VIEWPORT } from "./film.ts"

const HARNESS_DIR = resolve(import.meta.dirname, "../..")

async function freePort(): Promise<number> {
  const server = createServer()
  const { promise, resolve: done } = Promise.withResolvers<number>()
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    server.close(() => done(typeof address === "object" && address ? address.port : 0))
  })
  return promise
}

/** A Vite serving `/harness` only for replay — nothing behind `/pty`. */
async function startVite(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort()
  // The binary itself, not `bun run vite`: the wrapper reports our SIGTERM as a failure.
  const vite = Bun.spawn([join(HARNESS_DIR, "node_modules", ".bin", "vite"), "dev", "--port", String(port), "--strictPort"], {
    cwd: HARNESS_DIR,
    stdio: ["ignore", "ignore", "inherit"],
  })
  const url = `http://localhost:${port}`
  for (let i = 0; i < 150; i += 1) {
    if (await fetch(`${url}/harness`).then((r) => r.ok, () => false)) return { url, stop: () => vite.kill() }
    await Bun.sleep(200)
  }
  vite.kill()
  throw new Error("vite never came up for the replay page")
}

/**
 * A replay page with the take loaded. Always DPR 1: at a higher device scale
 * xterm lays cells out at device size, overflows the viewport, and the frame
 * shows a corner of the TUI (the same fault HARNESS.md records for stills).
 */
async function openReplay(
  browser: Browser,
  baseUrl: string,
  film: Film,
  cast: string,
): Promise<{ page: Page; markers: CastMarker[] }> {
  const page = await browser.newPage({ viewport: film.viewport ?? VIEWPORT })
  const wallpaper = film.wallpaper ? `&wallpaper=${encodeURIComponent(film.wallpaper)}` : ""
  await page.goto(`${baseUrl}/harness?replay${wallpaper}`)
  await page.locator('[data-replay-ready="true"]').waitFor({ timeout: 30_000 })
  const loaded = await page.evaluate((text) => window.__replay?.load(text), cast)
  if (!loaded) throw new Error("the replay page never exposed window.__replay")
  return { page, markers: loaded.markers }
}

/** One PNG per entry of `times` into `dir`. */
async function shoot(page: Page, times: readonly number[], dir: string, label: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  let frame: Buffer | null = null
  for (const [i, t] of times.entries()) {
    const changed = await page.evaluate((at) => window.__replay?.seek(at), t)
    // An unchanged screen is the previous frame; skipping the screenshot is
    // what makes idle stretches cheap.
    if (changed || !frame) frame = await page.screenshot({ type: "png" })
    await writeFile(join(dir, `${String(i).padStart(5, "0")}.png`), frame)
    if ((i + 1) % 240 === 0) console.error(`[film:${label}] ${i + 1}/${times.length} frames`)
  }
  console.error(`[film:${label}] ${times.length} frames`)
}

function readClipCuts(path: string, raw: string): Record<string, readonly Segment[]> {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || !("clips" in parsed) || !parsed.clips || typeof parsed.clips !== "object") {
    throw new Error(`${path}: expected { "clips": { <id>: Segment[] } }`)
  }
  return parsed.clips as Record<string, readonly Segment[]>
}

export async function render(film: Film): Promise<void> {
  const cast = gunzipSync(await readFile(castPath(film.name))).toString("utf8")
  const workDir = join(REPO_ROOT, ".scratch", "film", film.name)
  await rm(workDir, { recursive: true, force: true })
  const own = film.cut && (film.out.mp4 || film.out.gif) ? film.cut : null
  const clips = film.out.clips
  const clipCuts = clips ? readClipCuts(clips.cutFile, await readFile(join(REPO_ROOT, clips.cutFile), "utf8")) : {}
  const clipIndex: Record<string, { duration: number; width: number; height: number }> = {}

  const vite = await startVite()
  const browser = await chromium.launch({ headless: true })
  try {
    const { page, markers } = await openReplay(browser, vite.url, film, cast)
    if (own) await shoot(page, frameTimes(own, markers, FPS), join(workDir, "frames"), film.name)
    if (clips) {
      const { width, height } = film.viewport ?? VIEWPORT
      for (const [id, cut] of Object.entries(clipCuts)) {
        const times = frameTimes(cut, markers, clips.fps)
        await shoot(page, times, join(workDir, "clips", id), `${film.name}/${id}`)
        clipIndex[id] = { duration: times.length / clips.fps, width, height }
      }
    }
  } finally {
    await browser.close()
    vite.stop()
  }
  if (own) await encode({ framesDir: join(workDir, "frames"), workDir, fps: FPS, out: film.out })
  if (clips) {
    const dir = join(REPO_ROOT, clips.dir)
    await mkdir(dir, { recursive: true })
    for (const id of Object.keys(clipIndex)) encodeClip(join(workDir, "clips", id), clips.fps, join(dir, `${id}.mp4`))
    await writeFile(join(dir, "clips.json"), `${JSON.stringify(clipIndex, null, 2)}\n`)
    console.log(dir)
  }
}

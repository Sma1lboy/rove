/**
 * Render a film from its committed cast: `/harness?replay` on a private Vite,
 * one seek + screenshot per output frame, then encode. No PTY, daemon, engine
 * or fixture is involved, so the same cast and cut always give the same frames.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { gunzipSync } from "node:zlib"
import { chromium } from "@playwright/test"
import { REPO_ROOT } from "../hero-capture.ts"
import { encode } from "./encode.ts"
import { castPath, type Film, FPS, frameTimes, VIEWPORT } from "./film.ts"

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

export async function render(film: Film): Promise<void> {
  const text = gunzipSync(await readFile(castPath(film.name))).toString("utf8")
  const workDir = join(REPO_ROOT, ".scratch", "film", film.name)
  const framesDir = join(workDir, "frames")
  await rm(workDir, { recursive: true, force: true })
  await mkdir(framesDir, { recursive: true })

  const vite = await startVite()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: VIEWPORT })
    const wallpaper = film.wallpaper ? `&wallpaper=${encodeURIComponent(film.wallpaper)}` : ""
    await page.goto(`${vite.url}/harness?replay${wallpaper}`)
    await page.locator('[data-replay-ready="true"]').waitFor({ timeout: 30_000 })
    const { markers } = await page.evaluate((cast) => window.__replay?.load(cast), text) ?? { markers: [] }
    const times = frameTimes(film.cut, markers, FPS)
    let frame: Buffer | null = null
    for (const [i, t] of times.entries()) {
      const changed = await page.evaluate((at) => window.__replay?.seek(at), t)
      // An unchanged screen is the previous frame; skipping the screenshot is
      // what makes idle stretches cheap.
      if (changed || !frame) frame = await page.screenshot({ type: "png" })
      await writeFile(join(framesDir, `${String(i).padStart(5, "0")}.png`), frame)
      if ((i + 1) % 240 === 0) console.error(`[film:${film.name}] ${i + 1}/${times.length} frames`)
    }
    console.error(`[film:${film.name}] ${times.length} frames, ${(times.length / FPS).toFixed(1)}s`)
  } finally {
    await browser.close()
    vite.stop()
  }
  await encode({ framesDir, workDir, fps: FPS, out: film.out })
}

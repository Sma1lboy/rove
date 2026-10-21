/**
 * Colour probes: seek the replay to each probe's time, screenshot it, and
 * count the pixels near the probe's colour inside its cell region. Decoding
 * happens in the page (a canvas over the screenshot), so no PNG library and
 * no ffmpeg build is involved.
 */

import type { Page } from "@playwright/test"
import type { CastMarker } from "../../src/lib/cast.ts"
import { type ColorProbe, type Film, pointTime } from "./film.ts"

type Grid = { readonly cols: number; readonly rows: number }

/** The cast's own cell grid, from its header line. */
export function castGrid(cast: string): Grid {
  const header = JSON.parse(cast.slice(0, cast.indexOf("\n"))) as { width: number; height: number }
  return { cols: header.width, rows: header.height }
}

async function countNear(page: Page, probe: ColorProbe, grid: Grid): Promise<number> {
  const png = (await page.screenshot({ type: "png" })).toString("base64")
  return page.evaluate(
    async ({ png, region, rgb, tolerance, grid }) => {
      const screen = document.querySelector(".xterm-screen")?.getBoundingClientRect()
      if (!screen) throw new Error("no .xterm-screen on the replay page")
      const cellW = screen.width / grid.cols
      const cellH = screen.height / grid.rows
      const x = Math.round(screen.left + region.col0 * cellW)
      const y = Math.round(screen.top + region.row0 * cellH)
      const w = Math.round((region.col1 - region.col0) * cellW)
      const h = Math.round((region.row1 - region.row0) * cellH)
      const img = new Image()
      img.src = `data:image/png;base64,${png}`
      await img.decode()
      const ctx = new OffscreenCanvas(w, h).getContext("2d")
      if (!ctx) throw new Error("no 2d context")
      ctx.drawImage(img, -x, -y)
      const data = ctx.getImageData(0, 0, w, h).data
      let hits = 0
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - rgb[0]) <= tolerance &&
          Math.abs(data[i + 1] - rgb[1]) <= tolerance &&
          Math.abs(data[i + 2] - rgb[2]) <= tolerance
        )
          hits += 1
      }
      return hits
    },
    { png, region: probe.region, rgb: probe.rgb, tolerance: probe.tolerance, grid },
  )
}

/** Throws on the first probe the take fails. Leaves the replay seeked to the last probe. */
export async function assertColorProbes(page: Page, film: Film, markers: readonly CastMarker[], grid: Grid): Promise<void> {
  for (const probe of film.colorProbes ?? []) {
    await page.evaluate((t) => window.__replay?.seek(t), pointTime(probe.at, markers))
    const hits = await countNear(page, probe, grid)
    const rgb = `rgb(${probe.rgb.join(",")})`
    if (hits < probe.minPixels) {
      throw new Error(
        `[film:${film.name}] colour probe "${probe.label}" found ${hits} px near ${rgb} (needs ${probe.minPixels}) — ` +
          "the engine drew without colour; check the take's environment (NO_COLOR / CI / TERM)",
      )
    }
    console.error(`[film:${film.name}] colour probe "${probe.label}": ${hits} px near ${rgb}`)
  }
}

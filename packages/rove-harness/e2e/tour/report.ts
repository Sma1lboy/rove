/** The tour's pages: a captioned grid, a before/after of what changed, and the share split for a 4 MB host. */

import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import type { Shot } from "./shoot.ts"

const STYLE = `body{margin:0;padding:24px;background:#141413;color:#ece9e1;font:13px/1.4 -apple-system,system-ui,sans-serif}
h1{font-size:18px;margin:0 0 4px}p{color:#a8a499;margin:0 0 20px}h2{font-size:14px;margin:28px 0 10px;color:#cc785c}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px}main.pairs{grid-template-columns:1fr}
figure{margin:0;background:#1d1c1a;border-radius:6px;overflow:hidden}img{width:100%;display:block}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:2px}.phone img{max-width:390px;margin:auto}
figcaption{padding:8px 10px}figcaption b{color:#cc785c;font-family:ui-monospace,Menlo,monospace;margin-right:6px}`

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")
const label = (s: Shot) =>
  `<b>${esc(s.entry)}${s.page > 1 ? ` p${s.page}` : ""}</b>${esc(s.caption)}${s.viewport === "phone" ? " · phone" : ""}${s.variant === "default" ? "" : ` · ${s.variant}`}`

/** `src` maps a shot's file to what the page embeds (a relative path, or a data URL when sharing). */
export function gridPage(title: string, note: string, shots: readonly Shot[], src: (file: string) => string): string {
  const figs = shots.map(
    (s) =>
      `<figure class="${s.viewport}"><a href="${src(s.file)}" target="_blank"><img src="${src(s.file)}" loading="lazy"></a><figcaption>${label(s)}</figcaption></figure>`,
  )
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style><h1>${esc(title)}</h1><p>${esc(note)}</p><main>${figs.join("\n")}</main>\n`
}

export interface Change {
  readonly shot: Shot
  readonly kind: "changed" | "added" | "removed"
  readonly pixels?: number
}

export function comparePage(title: string, note: string, changes: readonly Change[], src: (side: "before" | "after", file: string) => string): string {
  const figs = changes.map(({ shot, kind, pixels }) => {
    const img = (side: "before" | "after") => `<img src="${src(side, shot.file)}" loading="lazy" title="${side}">`
    const body = kind === "changed" ? `<div class="pair">${img("before")}${img("after")}</div>` : img(kind === "added" ? "after" : "before")
    const what = kind === "changed" ? `${pixels} pixels differ (left before, right after)` : kind
    return `<figure class="${shot.viewport}">${body}<figcaption>${label(shot)} · ${what}</figcaption></figure>`
  })
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style><h1>${esc(title)}</h1><p>${esc(note)}</p><main class="pairs">${figs.join("\n")}</main>\n`
}

/** Per-channel difference a pixel needs to count, and pixels a shot needs to count as changed: antialiasing stays under both. */
const CHANNEL = 24
export const NOISE_PIXELS = 50

/** Pixels that differ between two PNGs; a size change counts as all of them. Decoded in the browser: no image library. */
export async function diffPixels(bench: Page, a: Buffer, b: Buffer): Promise<number> {
  return bench.evaluate(
    async ([a, b, channel]) => {
      const load = async (png: string) => {
        const image = new Image()
        image.src = `data:image/png;base64,${png}`
        await image.decode()
        const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d")!
        ctx.drawImage(image, 0, 0)
        return ctx.getImageData(0, 0, image.width, image.height)
      }
      const [x, y] = await Promise.all([load(a as string), load(b as string)])
      if (x.width !== y.width || x.height !== y.height) return x.width * x.height
      let count = 0
      for (let i = 0; i < x.data.length; i += 4) {
        if (
          Math.abs(x.data[i]! - y.data[i]!) > (channel as number) ||
          Math.abs(x.data[i + 1]! - y.data[i + 1]!) > (channel as number) ||
          Math.abs(x.data[i + 2]! - y.data[i + 2]!) > (channel as number)
        )
          count++
      }
      return count
    },
    [a.toString("base64"), b.toString("base64"), CHANNEL] as const,
  )
}

/** A PNG as a JPEG data URL at most `maxWidth` CSS-wide, for a page that has to carry its images inline. */
export async function jpegDataUrl(bench: Page, png: Buffer, maxWidth: number): Promise<string> {
  return bench.evaluate(
    async ([b64, maxWidth]) => {
      const image = new Image()
      image.src = `data:image/png;base64,${b64}`
      await image.decode()
      const scale = Math.min(1, (maxWidth as number) / image.width)
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(image.width * scale)
      canvas.height = Math.round(image.height * scale)
      canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL("image/jpeg", 0.72)
    },
    [png.toString("base64"), maxWidth] as const,
  )
}

/** The share host caps a page at 4 MB; split the items so each page stays under it. */
export const PAGE_BUDGET = 3_700_000

export function splitBySize<T>(items: readonly T[], size: (item: T) => number): T[][] {
  const out: T[][] = [[]]
  let used = 0
  for (const item of items) {
    const n = size(item)
    if (used + n > PAGE_BUDGET && out.at(-1)!.length > 0) {
      out.push([])
      used = 0
    }
    out.at(-1)!.push(item)
    used += n
  }
  return out
}

export async function writeIndex(dir: string, title: string, note: string, shots: readonly Shot[]): Promise<string> {
  const path = join(dir, "index.html")
  await writeFile(path, gridPage(title, note, shots, (f) => f))
  await writeFile(join(dir, "shots.json"), `${JSON.stringify(shots, null, 2)}\n`)
  return path
}

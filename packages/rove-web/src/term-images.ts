/**
 * Paints Kitty placeholder images over an xterm.js terminal. xterm keeps the placeholder cells
 * as text (they would draw as boxes); a canvas over its screen covers each run of them with its
 * slice of the image, fitted into the placement's cell box like Kitty does. A run whose image
 * this page never received (sent before the ring's start) is drawn as a plain frame, not text.
 */

import type { IBufferCell, Terminal } from "@xterm/xterm"
import { KittyImages, type PlaceholderCell, placeholderDiacritics, resolvePlaceholder } from "./term-kitty.ts"
import { TERM_IMAGES } from "./ui/shell.ts"

interface Run extends PlaceholderCell {
  readonly x: number
  readonly y: number
  len: number
}

const PLACEHOLDER_TEXT = "\u{10EEEE}"

function fgId(cell: IBufferCell): number {
  return cell.isFgRGB() || cell.isFgPalette() ? cell.getFgColor() : 0
}

/** Runs of placeholder cells on the visible screen, each one image row's consecutive columns. */
function visibleRuns(term: Terminal): Run[] {
  const buf = term.buffer.active
  const cell = buf.getNullCell()
  const runs: Run[] = []
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(buf.viewportY + y)
    if (!line?.translateToString(false).includes(PLACEHOLDER_TEXT)) continue
    let left: PlaceholderCell | null = null
    let run: Run | null = null
    for (let x = 0; x < term.cols; x++) {
      line.getCell(x, cell)
      const numbers = placeholderDiacritics(cell.getChars())
      if (!numbers) {
        left = null
        run = null
        continue
      }
      const p = resolvePlaceholder(fgId(cell), numbers, left)
      if (run && run.id === p.id && run.row === p.row && run.col + run.len === p.col) run.len++
      else {
        run = { ...p, x, y, len: 1 }
        runs.push(run)
      }
      left = p
    }
  }
  return runs
}

export interface TermImages {
  /** Output headed for `term.write`, observed for image commands. */
  push(bytes: Uint8Array): void
  dispose(): void
}

export function attachKittyImages(term: Terminal): TermImages {
  let canvas: HTMLCanvasElement | null = null
  let frame = 0
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw)
  }
  const images = new KittyImages(schedule)

  const draw = () => {
    frame = 0
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen")
    if (!screen || term.rows <= 0 || term.cols <= 0) return
    const runs = visibleRuns(term)
    if (runs.length === 0 && !canvas) return
    if (!canvas) {
      canvas = document.createElement("canvas")
      canvas.className = TERM_IMAGES
      screen.append(canvas)
    }
    const dpr = window.devicePixelRatio || 1
    const w = screen.clientWidth
    const h = screen.clientHeight
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const cw = w / term.cols
    const ch = h / term.rows
    const background = term.options.theme?.background ?? "#000"
    for (const run of runs) {
      const rx = run.x * cw
      const ry = run.y * ch
      const rw = run.len * cw
      ctx.fillStyle = background
      ctx.fillRect(rx, ry, rw, ch)
      const image = images.images.get(run.id)
      const bitmap = image?.bitmap
      if (!bitmap) {
        ctx.fillStyle = "rgba(128, 128, 128, 0.14)"
        ctx.fillRect(rx, ry, rw, ch)
        continue
      }
      const cols = image.cols ?? Math.ceil(bitmap.width / cw)
      const rows = image.rows ?? Math.ceil(bitmap.height / ch)
      const scale = Math.min((cols * cw) / bitmap.width, (rows * ch) / bitmap.height)
      const dw = bitmap.width * scale
      const dh = bitmap.height * scale
      // The whole placement box, positioned from this run's place in it; the clip keeps only the run.
      const bx = rx - run.col * cw + (cols * cw - dw) / 2
      const by = ry - run.row * ch + (rows * ch - dh) / 2
      ctx.save()
      ctx.beginPath()
      ctx.rect(rx, ry, rw, ch)
      ctx.clip()
      ctx.drawImage(bitmap, bx, by, dw, dh)
      ctx.restore()
    }
  }

  const subs = [term.onRender(schedule), term.onResize(schedule), term.onScroll(schedule)]
  return {
    push: (bytes) => images.push(bytes),
    dispose() {
      if (frame) cancelAnimationFrame(frame)
      for (const sub of subs) sub.dispose()
      canvas?.remove()
      images.dispose()
    },
  }
}

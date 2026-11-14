/** The terminal's WebGL renderer: loading it, keeping its canvas painted, and giving its context back. */

import { WebglAddon } from "@xterm/addon-webgl"
import type { Terminal } from "@xterm/xterm"

/** The private corner of xterm 6's RenderService that paints rows now instead of on the next frame. */
type RenderServiceInternals = {
  readonly _isPaused?: boolean
  _renderRows?(start: number, end: number): void
}

let fontsTrimmed = false

/**
 * Electron 45's Chromium rejects a canvas font with leading whitespace and keeps `10px sans-serif`; addon-webgl
 * 0.19 writes ` normal 26px …` for every upright glyph, so its atlas draws them tiny. Trim where the parser does.
 */
function trimCanvasFonts(): void {
  if (fontsTrimmed) return
  fontsTrimmed = true
  const probe = document.createElement("canvas").getContext("2d")
  if (!probe) return
  probe.font = " 12px monospace"
  if (probe.font.startsWith("12px")) return
  const font = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font")
  const { get, set } = font ?? {}
  if (!font || !get || !set) return
  Object.defineProperty(CanvasRenderingContext2D.prototype, "font", {
    ...font,
    set(value: string) {
      set.call(this, typeof value === "string" ? value.trim() : value)
    },
  })
}

/**
 * addon-webgl 0.19 keeps a cleared page's glyph list and counts texture versions per page. An atlas that is cleared
 * after each merge grows those lists until a merge can no longer spread one (`RangeError` on every draw: the screen
 * stops painting), and a terminal sharing the atlas keeps a texture whose version equals that of the page now at its
 * index (other glyphs, or none). So an atlas is never cleared, it is replaced: `normal` and `400` draw alike and are
 * different atlases. Every terminal takes the same weight within a frame, so they go on sharing one.
 */
let weight: "normal" | "400" = "normal"
let turned = 0
function turnAtlas(): void {
  if (turned) return
  weight = weight === "normal" ? "400" : "normal"
  turned = requestAnimationFrame(() => {
    turned = 0
  })
}

/** Load the WebGL renderer on an opened terminal; without WebGL the DOM renderer stays. Dispose after `term.dispose()`. */
export function loadWebgl(term: Terminal): { dispose(): void } {
  let webgl: WebglAddon | null = null
  let glCanvas: HTMLCanvasElement | null = null
  // A full atlas merges its pages, and rows drawn from a dropped page are blank or garbled until they change; the
  // atlas also keeps each glyph as first drawn, before a late font (the symbols face, bold) arrived. Kitty image
  // placeholders (a distinct glyph per cell) fill it in one paste. The merge's event fires inside a draw, so the
  // terminal moves to the new atlas on the next frame.
  let moving = 0
  const freshAtlas = () => {
    turnAtlas()
    if (moving) return
    moving = requestAnimationFrame(() => {
      moving = 0
      term.options.fontWeight = weight
    })
  }
  try {
    trimCanvasFonts()
    term.options.fontWeight = weight
    const before = new Set(term.element?.querySelectorAll("canvas"))
    const addon = new WebglAddon()
    addon.onContextLoss(() => {
      addon.dispose()
      webgl = null
    })
    addon.onRemoveTextureAtlasCanvas(freshAtlas)
    term.loadAddon(addon)
    webgl = addon
    glCanvas =
      [...(term.element?.querySelectorAll("canvas") ?? [])].find(
        (c) => !before.has(c) && !c.classList.contains("xterm-link-layer"),
      ) ?? null
  } catch {
    // The DOM renderer is slower but complete.
  }
  // addon-webgl 0.19 snaps its canvas to the device-pixel box in a ResizeObserver that runs after the frame's
  // render, which clears it until xterm 6's next rAF: a blank frame per resize. This observer runs after that
  // one, before paint; xterm has no public synchronous render.
  const repaint = new ResizeObserver(() => {
    const renderer = (term as unknown as { _core?: { _renderService?: RenderServiceInternals } })._core?._renderService
    if (webgl && renderer && !renderer._isPaused && typeof renderer._renderRows === "function") {
      renderer._renderRows(0, term.rows - 1)
    }
  })
  if (glCanvas) {
    try {
      repaint.observe(glCanvas, { box: "device-pixel-content-box" })
    } catch {
      // Without the device-pixel box the addon never re-sizes its canvas after a render.
    }
  }
  document.fonts.addEventListener("loadingdone", freshAtlas)
  return {
    dispose() {
      document.fonts.removeEventListener("loadingdone", freshAtlas)
      if (moving) cancelAnimationFrame(moving)
      repaint.disconnect()
      // A disposed renderer keeps its context until GC; past ~16 the browser kills the oldest, maybe a parked one's.
      glCanvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext()
    },
  }
}

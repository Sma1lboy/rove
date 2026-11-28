/** The terminal's WebGL renderer: loading it, keeping its canvas painted, and giving its context back. */

import type { CanvasAddon } from "@xterm/addon-canvas"
import { WebglAddon } from "@xterm/addon-webgl"
import type { Terminal } from "@xterm/xterm"

/** The private corner of xterm 6's RenderService that paints rows now instead of on the next frame. */
type RenderServiceInternals = {
  readonly _isPaused?: boolean
  _renderRows?(start: number, end: number): void
  handleCharSizeChanged?(): void
}

/**
 * Under DevTools device emulation Chromium reports `device-pixel-content-box` at the real screen's ratio, not the
 * emulated one. Both renderers size their canvas from that box, so glyphs drawn for one ratio land on a canvas
 * sized for another. A true box is within a pixel of CSS size times the ratio.
 */
function boxLies(entry: ResizeObserverEntry | undefined): boolean {
  const box = entry?.devicePixelContentBoxSize?.[0]
  return !!box && Math.abs(box.inlineSize - entry.contentRect.width * window.devicePixelRatio) > 2
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

/** WebGL and Canvas 2D both tile block glyphs to the cell edges. Dispose after `term.dispose()`. */
export function loadTerminalRenderer(term: Terminal, refit: () => void): { dispose(): void } {
  let webgl: WebglAddon | null = null
  let canvas: CanvasAddon | null = null
  let disposed = false
  const fallback = async () => {
    try {
      const { CanvasAddon } = await import("@xterm/addon-canvas")
      if (disposed) return
      const addon = new CanvasAddon()
      // addon-canvas 0.7 puts the DOM renderer back on dispose, which throws in a disposed terminal; xterm has
      // already disposed the canvas renderer by then.
      const dispose = addon.dispose.bind(addon)
      const core = (term as unknown as { _core?: { _store?: { _isDisposed?: boolean } } })._core
      addon.dispose = () => {
        if (!core?._store?._isDisposed) dispose()
      }
      term.loadAddon(addon)
      canvas = addon
      const layer = term.element?.querySelector("canvas.xterm-text-layer")
      if (layer) watch(layer)
    } catch {
      // xterm keeps its DOM renderer when Canvas 2D is also unavailable.
      return
    }
    refit()
  }
  // addon-webgl 0.19 snaps its canvas to the device-pixel box in a ResizeObserver that runs after the frame's
  // render, which clears it until xterm 6's next rAF: a blank frame per resize. An observer made after the
  // renderer's runs after it, before paint; xterm has no public synchronous render.
  const observers: ResizeObserver[] = []
  function watch(target: Element): void {
    const observer = new ResizeObserver(([entry]) => {
      const renderer = (term as unknown as { _core?: { _renderService?: RenderServiceInternals } })._core
        ?._renderService
      if (!renderer) return
      const lies = boxLies(entry)
      // Sizes the canvas from the ratio again, as before the renderer read the box.
      if (lies) renderer.handleCharSizeChanged?.()
      if (webgl && !renderer._isPaused) renderer._renderRows?.(0, term.rows - 1)
      else if (lies) term.refresh(0, term.rows - 1)
    })
    observers.push(observer)
    try {
      observer.observe(target, { box: "device-pixel-content-box" })
    } catch {
      // Without the device-pixel box the renderer never re-sizes its canvas after a render.
    }
  }
  let glCanvas: HTMLCanvasElement | null = null
  // A full atlas merges its pages, and rows drawn from a dropped page are blank or garbled until they change.
  // Kitty image placeholders (a distinct glyph per cell) fill it in one paste. The merge's event fires inside a draw,
  // so the terminal moves to the new atlas on the next frame.
  let moving = 0
  const move = () => {
    if (moving) return
    moving = requestAnimationFrame(() => {
      moving = 0
      term.options.fontWeight = weight
    })
  }
  const freshAtlas = () => {
    turnAtlas()
    move()
  }
  // A GPU reset empties the atlas's page canvases while its glyph cache still lists them, and the addon rebuilds
  // an atlas only when one terminal owns it: sharers re-upload the empty pages, so every glyph drawn before the
  // reset is blank. Contexts come back frames apart, so each terminal leaves the atlas it was on, not `turnAtlas`.
  const onRestored = () => {
    weight = term.options.fontWeight === "normal" ? "400" : "normal"
    move()
  }
  try {
    trimCanvasFonts()
    term.options.fontWeight = weight
    const before = new Set(term.element?.querySelectorAll("canvas"))
    const addon = new WebglAddon()
    addon.onContextLoss(() => {
      addon.dispose()
      webgl = null
      void fallback()
    })
    addon.onRemoveTextureAtlasCanvas(freshAtlas)
    term.loadAddon(addon)
    webgl = addon
    glCanvas =
      [...(term.element?.querySelectorAll("canvas") ?? [])].find(
        (c) => !before.has(c) && !c.classList.contains("xterm-link-layer"),
      ) ?? null
  } catch {
    void fallback()
  }
  glCanvas?.addEventListener("webglcontextrestored", onRestored)
  if (glCanvas) watch(glCanvas)
  // The atlas keeps each glyph as first drawn: redraw once a late font (the symbols face, bold) arrives. Moving to a
  // new atlas here blanks a terminal for two frames on a task switch, whose views load fonts; a font arrives a few
  // times a page, so the clear's growth stays small.
  const redraw = () => {
    const renderer = webgl ?? canvas
    if (!renderer) return
    renderer.clearTextureAtlas()
    term.refresh(0, term.rows - 1)
  }
  document.fonts.addEventListener("loadingdone", redraw)
  // A hidden tab can lose its canvas or atlas texture to GPU memory pressure with the context still alive, and
  // xterm redraws nothing that did not change: rebuild both when the tab is shown again.
  const onShown = () => {
    if (document.visibilityState === "visible") redraw()
  }
  document.addEventListener("visibilitychange", onShown)
  return {
    dispose() {
      disposed = true
      document.fonts.removeEventListener("loadingdone", redraw)
      document.removeEventListener("visibilitychange", onShown)
      glCanvas?.removeEventListener("webglcontextrestored", onRestored)
      if (moving) cancelAnimationFrame(moving)
      for (const observer of observers) observer.disconnect()
      // A disposed renderer keeps its context until GC; past ~16 the browser kills the oldest, maybe a parked one's.
      glCanvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext()
    },
  }
}

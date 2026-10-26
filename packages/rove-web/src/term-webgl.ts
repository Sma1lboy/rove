/** The terminal's WebGL renderer: loading it, keeping its canvas painted, and giving its context back. */

import { WebglAddon } from "@xterm/addon-webgl"
import type { Terminal } from "@xterm/xterm"

/** The private corner of xterm 6's RenderService that paints rows now instead of on the next frame. */
type RenderServiceInternals = {
  readonly _isPaused?: boolean
  _renderRows?(start: number, end: number): void
}

/** Load the WebGL renderer on an opened terminal; without WebGL the DOM renderer stays. Dispose after `term.dispose()`. */
export function loadWebgl(term: Terminal): { dispose(): void } {
  let webgl: WebglAddon | null = null
  let glCanvas: HTMLCanvasElement | null = null
  try {
    const before = new Set(term.element?.querySelectorAll("canvas"))
    const addon = new WebglAddon()
    addon.onContextLoss(() => {
      addon.dispose()
      webgl = null
    })
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
  // The atlas keeps each glyph as first drawn: redraw once a late font (the symbols face, bold) arrives.
  const onFontLoaded = () => {
    if (!webgl) return
    webgl.clearTextureAtlas()
    term.refresh(0, term.rows - 1)
  }
  document.fonts.addEventListener("loadingdone", onFontLoaded)
  return {
    dispose() {
      document.fonts.removeEventListener("loadingdone", onFontLoaded)
      repaint.disconnect()
      // A disposed renderer keeps its context until GC; past ~16 the browser kills the oldest, maybe a parked one's.
      glCanvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext()
    },
  }
}

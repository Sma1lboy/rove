import { CanvasAddon } from "@xterm/addon-canvas"
import { WebglAddon } from "@xterm/addon-webgl"
import type { Terminal } from "@xterm/xterm"

export type TerminalRendererMode = "automatic" | "dom"

type TerminalAddonLoader = Pick<Terminal, "loadAddon">

function loadCanvasRenderer(terminal: TerminalAddonLoader): void {
  try {
    terminal.loadAddon(new CanvasAddon())
  } catch {
    /* DOM renderer fallback */
  }
}

export function loadTerminalRenderer(
  terminal: TerminalAddonLoader,
  renderer: TerminalRendererMode,
  transparent: boolean,
): void {
  if (renderer === "dom") return
  if (transparent) {
    loadCanvasRenderer(terminal)
    return
  }

  let webgl: WebglAddon | undefined
  const fallbackToCanvas = (): void => {
    try {
      webgl?.dispose()
    } catch {
      /* renderer is already unusable */
    }
    loadCanvasRenderer(terminal)
  }

  try {
    webgl = new WebglAddon()
    webgl.onContextLoss(fallbackToCanvas)
    terminal.loadAddon(webgl)
  } catch {
    fallbackToCanvas()
  }
}

import type { ITerminalAddon } from "@xterm/xterm"
import { beforeEach, describe, expect, it, vi } from "vitest"

type RendererMockState = {
  canvasConstructions: number
  contextLoss: (() => void) | undefined
  webglConstructions: number
  webglDisposals: number
}

const rendererState = vi.hoisted<RendererMockState>(() => ({
  canvasConstructions: 0,
  contextLoss: undefined,
  webglConstructions: 0,
  webglDisposals: 0,
}))

vi.mock("@xterm/addon-canvas", () => ({
  CanvasAddon: class CanvasAddon implements ITerminalAddon {
    constructor() {
      rendererState.canvasConstructions += 1
    }

    activate(): void {}
    dispose(): void {}
  },
}))

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class WebglAddon implements ITerminalAddon {
    constructor() {
      rendererState.webglConstructions += 1
    }

    activate(): void {}

    onContextLoss(listener: () => void): { dispose(): void } {
      rendererState.contextLoss = listener
      return { dispose() {} }
    }

    dispose(): void {
      rendererState.webglDisposals += 1
    }
  },
}))

import { CanvasAddon } from "@xterm/addon-canvas"
import { WebglAddon } from "@xterm/addon-webgl"
import { loadTerminalRenderer } from "../src/lib/terminal-renderer.ts"

function createTerminalLoader() {
  const loaded: ITerminalAddon[] = []
  let failCanvas = false
  let failWebgl = false

  return {
    loaded,
    failCanvas() {
      failCanvas = true
    },
    failWebgl() {
      failWebgl = true
    },
    terminal: {
      loadAddon(addon: ITerminalAddon): void {
        if (failWebgl && addon instanceof WebglAddon) {
          throw new Error("WebGL initialization failed")
        }
        if (failCanvas && addon instanceof CanvasAddon) {
          throw new Error("Canvas initialization failed")
        }
        loaded.push(addon)
      },
    },
  }
}

describe("terminal renderer addon selection", () => {
  beforeEach(() => {
    rendererState.canvasConstructions = 0
    rendererState.contextLoss = undefined
    rendererState.webglConstructions = 0
    rendererState.webglDisposals = 0
  })

  it("keeps transparent DOM mode on the DOM renderer", () => {
    const loader = createTerminalLoader()

    loadTerminalRenderer(loader.terminal, "dom", true)

    expect(loader.loaded).toEqual([])
    expect(rendererState.canvasConstructions).toBe(0)
    expect(rendererState.webglConstructions).toBe(0)
  })

  it("uses Canvas for transparent automatic mode", () => {
    const loader = createTerminalLoader()

    loadTerminalRenderer(loader.terminal, "automatic", true)

    expect(loader.loaded).toHaveLength(1)
    expect(loader.loaded[0]).toBeInstanceOf(CanvasAddon)
    expect(rendererState.webglConstructions).toBe(0)
  })

  it("falls back from failed WebGL initialization through Canvas to DOM", () => {
    const loader = createTerminalLoader()
    loader.failWebgl()

    loadTerminalRenderer(loader.terminal, "automatic", false)

    expect(rendererState.webglDisposals).toBe(1)
    expect(loader.loaded).toHaveLength(1)
    expect(loader.loaded[0]).toBeInstanceOf(CanvasAddon)

    const domFallback = createTerminalLoader()
    domFallback.failWebgl()
    domFallback.failCanvas()
    expect(() =>
      loadTerminalRenderer(domFallback.terminal, "automatic", false),
    ).not.toThrow()
    expect(domFallback.loaded).toEqual([])
  })

  it("falls back from WebGL context loss through Canvas to DOM", () => {
    const loader = createTerminalLoader()

    loadTerminalRenderer(loader.terminal, "automatic", false)
    expect(loader.loaded[0]).toBeInstanceOf(WebglAddon)

    rendererState.contextLoss?.()

    expect(rendererState.webglDisposals).toBe(1)
    expect(loader.loaded[1]).toBeInstanceOf(CanvasAddon)

    const domFallback = createTerminalLoader()
    loadTerminalRenderer(domFallback.terminal, "automatic", false)
    domFallback.failCanvas()
    expect(() => rendererState.contextLoss?.()).not.toThrow()
    expect(domFallback.loaded).toHaveLength(1)
    expect(domFallback.loaded[0]).toBeInstanceOf(WebglAddon)
  })
})

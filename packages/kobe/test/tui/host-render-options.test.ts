import { afterEach, describe, expect, it } from "vitest"
import {
  hostRenderOptions,
  installBracketedPasteMode,
  installPaneExitBackstop,
} from "../../src/tui/lib/host-render-options"
import { createHostImeOutput } from "../../src/tui/lib/ime-anchor-output"

function fakeTty(): NodeJS.WriteStream {
  return {
    columns: 120,
    rows: 40,
    write: () => true,
  } as unknown as NodeJS.WriteStream
}

/** A tty that records what was written to it. */
function recordingTty(isTTY = true): { stream: NodeJS.WriteStream; written: string[] } {
  const written: string[] = []
  return {
    written,
    stream: {
      isTTY,
      write: (chunk: string) => {
        written.push(chunk)
        return true
      },
    } as unknown as NodeJS.WriteStream,
  }
}

describe("hostRenderOptions", () => {
  it("spreads onDestroy in only when present (same shape otherwise)", () => {
    const onDestroy = () => {}
    expect(hostRenderOptions(onDestroy)).toMatchObject({ onDestroy })
    expect("onDestroy" in hostRenderOptions()).toBe(false)
  })

  it("uses the ordinary Kitty keypress protocol", () => {
    expect(hostRenderOptions()).toMatchObject({ useKittyKeyboard: {} })
  })
})

describe("createHostImeOutput", () => {
  it("uses a local custom-output feed only for fullscreen macOS hosts", () => {
    const stdout = fakeTty()
    const mac = createHostImeOutput({ platform: "darwin", fullscreen: true, stdout })

    expect(mac.rendererOptions.remote).toBe(false)
    expect(mac.rendererOptions.stdout).not.toBe(stdout)
    expect(mac.active).toBe(true)
  })

  it("leaves Linux and inline command hosts on the direct stdout path", () => {
    const stdout = fakeTty()

    expect(createHostImeOutput({ platform: "linux", fullscreen: true, stdout }).rendererOptions).toEqual({})
    expect(createHostImeOutput({ platform: "darwin", fullscreen: false, stdout }).rendererOptions).toEqual({})
  })
})

describe("installPaneExitBackstop", () => {
  const SIGNALS = ["SIGHUP", "SIGTERM", "SIGINT"] as const
  const added: Array<{ signal: (typeof SIGNALS)[number]; fn: NodeJS.SignalsListener }> = []

  afterEach(() => {
    for (const { signal, fn } of added.splice(0)) process.removeListener(signal, fn)
  })

  it("registers one delayed-exit listener per teardown signal", () => {
    const before = new Map(SIGNALS.map((s) => [s, process.listeners(s).length]))
    installPaneExitBackstop()
    for (const signal of SIGNALS) {
      const listeners = process.listeners(signal)
      expect(listeners.length).toBe((before.get(signal) ?? 0) + 1)
      added.push({ signal, fn: listeners.at(-1) as NodeJS.SignalsListener })
    }
  })
})

describe("installBracketedPasteMode", () => {
  const installed: Array<() => void> = []

  afterEach(() => {
    for (const restore of installed.splice(0)) {
      process.removeListener("exit", restore as NodeJS.ExitListener)
    }
  })

  it("turns the mode on, and its restore turns it back off exactly once", () => {
    const { stream, written } = recordingTty()
    const restore = installBracketedPasteMode(stream)
    installed.push(restore)
    // Without the enable the terminal sends a paste as plain keystrokes, and
    // every newline in it submits.
    expect(written).toEqual(["\x1b[?2004h"])

    restore()
    restore()
    expect(written).toEqual(["\x1b[?2004h", "\x1b[?2004l"])
  })

  it("registers the restore on exit so process.exit() still gives the mode back", () => {
    const before = process.listeners("exit").length
    const restore = installBracketedPasteMode(recordingTty().stream)
    installed.push(restore)
    expect(process.listeners("exit").length).toBe(before + 1)
  })

  it("does nothing when stdout is not a tty (piped output, tests)", () => {
    const { stream, written } = recordingTty(false)
    installBracketedPasteMode(stream)
    expect(written).toEqual([])
  })
})

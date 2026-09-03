import { afterEach, describe, expect, it, vi } from "vitest"
import {
  holdExitFor,
  hostRenderOptions,
  installBracketedPasteMode,
  installPaneExitBackstop,
  whenExitReady,
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

  it("requests kitty press, repeat, release, and all-keys-as-escapes reporting", () => {
    expect(hostRenderOptions()).toMatchObject({
      useKittyKeyboard: {},
    })
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

  /**
   * Install, then hand back a trigger that calls the registered listener
   * DIRECTLY. `process.emit("SIGTERM")` would also run vitest's own handlers
   * and take the runner down with it.
   */
  function install(opts: { ceilingMs?: number; exit?: (code: number) => void }): () => void {
    installPaneExitBackstop(opts)
    const fn = process.listeners("SIGTERM").at(-1) as NodeJS.SignalsListener
    for (const signal of SIGNALS) added.push({ signal, fn })
    return () => fn("SIGTERM")
  }

  it("registers one exit listener per teardown signal", () => {
    const before = new Map(SIGNALS.map((s) => [s, process.listeners(s).length]))
    install({ exit: () => {} })
    for (const signal of SIGNALS) {
      expect(process.listeners(signal).length).toBe((before.get(signal) ?? 0) + 1)
    }
  })

  it("exits as soon as nothing is in flight, rather than waiting out the ceiling", async () => {
    const exits: number[] = []
    // A ceiling this far out means only the readiness signal can end it.
    install({ ceilingMs: 60_000, exit: (code) => exits.push(code) })()
    await vi.waitFor(() => expect(exits).toEqual([0]))
  })

  it("holds the exit open until registered work settles", async () => {
    let finishWork!: () => void
    holdExitFor(
      new Promise<void>((resolve) => {
        finishWork = resolve
      }),
    )
    const exits: number[] = []
    install({ ceilingMs: 60_000, exit: (code) => exits.push(code) })()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(exits, "exited while a kill-own-session flow was still orchestrating").toEqual([])

    finishWork()
    await vi.waitFor(() => expect(exits).toEqual([0]))
  })

  it("gives up at the ceiling and says so, instead of hanging on stuck work", async () => {
    let abandon!: () => void
    holdExitFor(
      new Promise<void>((resolve) => {
        abandon = resolve
      }),
    )
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const exits: number[] = []
    install({ ceilingMs: 20, exit: (code) => exits.push(code) })()

    await vi.waitFor(() => expect(exits).toEqual([0]))
    expect(logged.mock.calls[0]?.[0]).toContain("still in flight after 20ms")

    logged.mockRestore()
    abandon() // drain the module-level set for the next test
    await whenExitReady()
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

/**
 * What a reattaching emulator and a headless engine see from the PTY host:
 *   - a full replay re-sets modes whose bytes the ring already trimmed (an
 *     engine's startup mouse tracking), also across a freeze/thaw;
 *   - DA1/DECRQM are answered by the host only while no emulator is attached.
 */

import type { PtyChild, PtyDriver, PtyExit } from "@sma1lboy/kobe-daemon/daemon/pty-driver"
import type { FrozenPtySession, PtyFreezeSink } from "@sma1lboy/kobe-daemon/daemon/pty-freeze-store"
import { PtyHost } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import { Terminal } from "@xterm/headless"
import { describe, expect, it } from "vitest"

class QuietChild {
  static nextPid = 5000
  readonly pid = QuietChild.nextPid++
  /** What the host wrote to the child's stdin (its query replies). */
  readonly stdin: string[] = []
  readonly exited = new Promise<PtyExit>(() => {})
  constructor(readonly emit: (data: string) => void) {}
  write(data: string): void {
    this.stdin.push(data)
  }
  resize(): void {}
  close(): void {}
  kill(): void {}
}

function harness(scrollbackCap = 64) {
  const children: QuietChild[] = []
  const saved = new Map<string, FrozenPtySession>()
  const driver: PtyDriver = (request) => {
    const child = new QuietChild((data) => request.onData(data))
    children.push(child)
    return child as unknown as PtyChild
  }
  const freeze: PtyFreezeSink = { save: (record) => saved.set(record.key, record), drop: (key) => saved.delete(key) }
  return { children, saved, host: new PtyHost({ driver, freeze, scrollbackCap }) }
}

const KEY = "t1::tab-1"
const SPEC = { cwd: "/wt/t1", command: ["omp"], cols: 80, rows: 24 }
const ENGINE_STARTUP = "\x1b[?2004h\x1b[?1000h\x1b[?1003h\x1b[?1006h"

async function emulate(replayB64: string): Promise<Terminal> {
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
  await new Promise<void>((resolve) => term.write(Buffer.from(replayB64, "base64"), resolve))
  return term
}

/** Enough redraw traffic to push the startup sequence out of a 64-byte ring. */
function scrollStartupOut(child: QuietChild): void {
  for (let i = 0; i < 8; i++) child.emit(`\x1b[H\x1b[2Kframe ${i} ${"x".repeat(40)}`)
}

describe("PtyHost terminal modes", () => {
  it("a reattach after the ring trimmed the engine's startup still has its mouse tracking", async () => {
    const h = harness()
    h.host.open(KEY, SPEC, {}, () => {})
    // Split mid-sequence: the chunk boundary must not lose the mode.
    h.children[0]?.emit(ENGINE_STARTUP.slice(0, 15))
    h.children[0]?.emit(ENGINE_STARTUP.slice(15))
    scrollStartupOut(h.children[0] as QuietChild)

    const reattach = h.host.open(KEY, SPEC, {}, () => {}, undefined, undefined, true)
    expect(Buffer.from(reattach.replay, "base64").toString("latin1")).not.toContain("?1003h\x1b[?1006h")
    const term = await emulate(reattach.replay)
    expect(term.modes.mouseTrackingMode).toBe("any")
    expect(term.modes.bracketedPasteMode).toBe(true)
  })

  it("keeps the trimmed ring's modes across a host restart", async () => {
    const first = harness()
    first.host.open(KEY, SPEC, {}, () => {})
    first.children[0]?.emit(ENGINE_STARTUP)
    scrollStartupOut(first.children[0] as QuietChild)
    first.host.flushFrozen()

    const second = harness()
    second.host.restoreFrozen([...first.saved.values()])
    const term = await emulate(second.host.open(KEY, SPEC, {}, () => {}).replay)
    expect(term.modes.mouseTrackingMode).toBe("any")
  })

  it("answers an engine's feature probe while only a headless caller is attached", () => {
    const h = harness(4096)
    h.host.open(KEY, SPEC, {}, () => {})
    h.children[0]?.emit("\x1b[?2026$p\x1b[?2004$p\x1b[c")
    expect(h.children[0]?.stdin.join("")).toBe("\x1b[?2026;2$y\x1b[?2004;2$y\x1b[?1;2c")
  })

  it("leaves the probe to an attached emulator, and takes it back once it detaches", () => {
    const h = harness(4096)
    const tui = {}
    h.host.open(KEY, SPEC, tui, () => {}, undefined, undefined, true)
    h.children[0]?.emit("\x1b[c")
    expect(h.children[0]?.stdin).toEqual([])

    h.host.detach(KEY, tui)
    h.children[0]?.emit("\x1b[c")
    expect(h.children[0]?.stdin.join("")).toBe("\x1b[?1;2c")
  })
})

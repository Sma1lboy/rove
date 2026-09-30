/**
 * A pane inside the GUI: graphics commands reach the real terminal, the
 * placeholder cells reach xterm, and `CSI 16 t` is answered with the GUI's
 * measured cell size. Everywhere else (no GUI installed a host) the emulator
 * must behave exactly as before.
 */

import { afterEach, describe, expect, it } from "vitest"
import { installTerminalGraphics } from "../../src/tui/lib/terminal-graphics"
import { FakeTransportPty, rowsText, settleRefresh } from "./pty-fake"

const apc = (body: string) => `\x1b_G${body}\x1b\\`
const PLACEHOLDER = "\u{10EEEE}\u0305\u0305"

class ReplyPty extends FakeTransportPty {
  readonly replies: string[] = []
  protected override transportWrite(data: string): void {
    this.replies.push(data)
  }
  replay(data: string | Uint8Array): void {
    this.feedReplay(data)
  }
}

function install(cellPixelSize: { width: number; height: number } | null, kitty = true) {
  const sent: string[] = []
  installTerminalGraphics({ cellPixelSize, writeKitty: kitty ? (b) => sent.push(b.toString("latin1")) : null })
  return sent
}

afterEach(() => installTerminalGraphics(null))

async function screenOf(pty: FakeTransportPty): Promise<string> {
  await settleRefresh()
  pty.onData(() => {})
  return rowsText(pty.capture())
}

describe("pane graphics passthrough", () => {
  // omp in placeholder mode: chunked transmit, virtual placement, startup delete-all.
  const ompOutput = [
    apc("a=d,d=A,q=2"),
    apc("a=t,f=100,q=2,i=1193046,m=1;AAAA"),
    apc("m=0;BBBB"),
    apc("a=p,U=1,q=2,i=1193046,p=1193046,c=41,r=12"),
    `${PLACEHOLDER}\r\n`,
  ].join("")

  it("sends the filtered APCs to the sink and the placeholder cells to xterm", async () => {
    const sent = install(null)
    const pty = new ReplyPty({ taskId: "t", cwd: "/wt", cols: 40, rows: 6, scrollback: 10 })
    await pty.pump(ompOutput)

    expect(sent).toEqual([
      apc("a=t,f=100,i=1193046,m=1,q=2;AAAA"),
      apc("m=0,q=2;BBBB"),
      apc("a=p,U=1,i=1193046,p=1193046,c=41,r=12,q=2"),
    ])
    expect(await screenOf(pty)).toContain(PLACEHOLDER)
    pty.kill()
  })

  it("forwards replay chunks too, even when the APC straddles two of them", async () => {
    const sent = install(null)
    const pty = new ReplyPty({ taskId: "t", cwd: "/wt", cols: 40, rows: 6, scrollback: 10 })
    const cut = ompOutput.indexOf("BBBB")
    pty.replay(Buffer.from(ompOutput.slice(0, cut)))
    pty.replay(Buffer.from(ompOutput.slice(cut)))
    await pty.pump("")

    expect(sent).toHaveLength(3)
    expect(await screenOf(pty)).toContain(PLACEHOLDER)
    pty.kill()
  })

  it("leaves xterm's input untouched when the GUI's terminal does not draw Kitty graphics", async () => {
    const sent = install({ width: 9, height: 18 }, false)
    const pty = new ReplyPty({ taskId: "t", cwd: "/wt", cols: 40, rows: 6, scrollback: 10 })
    await pty.pump(ompOutput)
    expect(sent).toEqual([])
    expect(await screenOf(pty)).toContain(PLACEHOLDER)
    pty.kill()
  })

  it("is a no-op outside a GUI (no host installed)", async () => {
    const pty = new ReplyPty({ taskId: "t", cwd: "/wt", cols: 40, rows: 6, scrollback: 10 })
    await pty.pump(ompOutput)
    expect(await screenOf(pty)).toContain(PLACEHOLDER)
    pty.kill()
  })
})

describe("pane CSI 16 t", () => {
  it("answers with height then width of the GUI's measured cell", async () => {
    install({ width: 16, height: 34 }, false)
    const pty = new ReplyPty({ taskId: "t", cwd: "/wt" })
    await pty.pump("\x1b[16t")
    expect(pty.replies).toEqual(["\x1b[6;34;16t"])
    pty.kill()
  })

  it("stays silent when the size is unknown or no GUI is attached", async () => {
    const pty = new ReplyPty({ taskId: "t", cwd: "/wt" })
    await pty.pump("\x1b[16t")
    install(null)
    await pty.pump("\x1b[16t")
    expect(pty.replies).toEqual([])
    pty.kill()
  })

  it("does not answer other window operations", async () => {
    install({ width: 16, height: 34 })
    const pty = new ReplyPty({ taskId: "t", cwd: "/wt" })
    await pty.pump("\x1b[14t\x1b[18t\x1b[16;1t")
    expect(pty.replies).toEqual([])
    pty.kill()
  })

  it("does not answer a query that arrives in replayed history", async () => {
    install({ width: 16, height: 34 })
    const pty = new ReplyPty({ taskId: "t", cwd: "/wt" })
    pty.replay("\x1b[16t")
    await pty.pump("")
    expect(pty.replies).toEqual([])
    pty.kill()
  })
})

/**
 * What a pane may hand to the GUI's real terminal. Pane output is untrusted
 * (`cat` of any file), so the filter forwards only commands that draw the same
 * from any cursor position, forces every one quiet so the outer terminal never
 * replies into the GUI's stdin, and hands xterm every other byte unchanged.
 */

import { describe, expect, it } from "vitest"
import { KittyGraphicsFilter } from "../../src/tui/panes/terminal/kitty-graphics"

const apc = (body: string) => `\x1b_G${body}\x1b\\`

function run(chunks: Array<string | Uint8Array>) {
  const filter = new KittyGraphicsFilter()
  const forwarded: string[] = []
  const rest: Buffer[] = []
  for (const chunk of chunks) {
    const out = filter.push(chunk, (b) => forwarded.push(b.toString()))
    rest.push(Buffer.from(out))
  }
  return { forwarded, rest: Buffer.concat(rest).toString() }
}

describe("KittyGraphicsFilter", () => {
  it("forwards omp's placeholder sequence and leaves the text for xterm", () => {
    const transmit1 = apc("a=t,f=100,q=2,i=1193046,m=1;AAAA")
    const transmit2 = apc("m=0;BBBB")
    const place = apc("a=p,U=1,q=2,i=1193046,p=1193046,c=41,r=12")
    const cells = "\u{10EEEE}\u0305\u0305\r\n"
    const { forwarded, rest } = run([`before${transmit1}${transmit2}${place}${cells}after`])
    expect(forwarded).toEqual([
      apc("a=t,f=100,i=1193046,m=1,q=2;AAAA"),
      apc("m=0,q=2;BBBB"),
      apc("a=p,U=1,i=1193046,p=1193046,c=41,r=12,q=2"),
    ])
    expect(rest).toBe(`before${cells}after`)
  })

  it("forces q=2 on every forwarded command and keeps the payload byte-exact", () => {
    const { forwarded } = run([
      apc("a=t,f=100,q=0,i=7,m=1;AAAA+/=="),
      apc("q=1,m=0;BBBB"),
      apc("a=p,U=1,i=7"),
      apc("a=d,d=I,i=7"),
    ])
    expect(forwarded).toEqual([
      apc("a=t,f=100,i=7,m=1,q=2;AAAA+/=="),
      apc("m=0,q=2;BBBB"),
      apc("a=p,U=1,i=7,q=2"),
      apc("a=d,d=I,i=7,q=2"),
    ])
  })

  it("forwards an a=T transmit only when it is a virtual placement", () => {
    const virtual = apc("a=T,U=1,f=100,i=9,c=10,r=5;AAAA")
    const direct = apc("a=T,f=100,i=9;AAAA")
    const { forwarded, rest } = run([virtual, direct])
    expect(forwarded).toEqual([apc("a=T,U=1,f=100,i=9,c=10,r=5,q=2;AAAA")])
    expect(rest).toBe("")
  })

  it.each([
    ["delete-all", "a=d,d=A"],
    ["delete-all lowercase", "a=d,d=a"],
    ["delete with no target defaults to all", "a=d"],
    ["delete by cursor position", "a=d,d=c"],
    ["delete by id range", "a=d,d=r,x=1,y=99999"],
    ["delete by id without an id", "a=d,d=i"],
    ["direct placement", "a=p,i=5"],
    ["query", "a=q,i=31,s=1,v=1"],
    ["animation frame", "a=f,i=5"],
    ["transmit from a file path", "a=t,t=f,i=5;L2V0Yy9wYXNzd2Q="],
  ])("drops %s", (_name, body) => {
    const { forwarded, rest } = run([`x${apc(body)}y`])
    expect(forwarded).toEqual([])
    expect(rest).toBe("xy")
  })

  it("forwards deletes by image id and by placement", () => {
    const { forwarded } = run([apc("a=d,d=i,i=5"), apc("a=d,d=I,i=5,p=5")])
    expect(forwarded).toEqual([apc("a=d,d=i,i=5,q=2"), apc("a=d,d=I,i=5,p=5,q=2")])
  })

  it("drops the continuation chunks of a dropped transfer, and keeps those of a forwarded one", () => {
    const { forwarded, rest } = run([
      apc("a=T,f=100,i=1,m=1;AAAA"),
      apc("m=1;BBBB"),
      apc("m=0;CCCC"),
      apc("a=t,f=100,i=2,m=1;DDDD"),
      apc("m=0;EEEE"),
    ])
    expect(forwarded).toEqual([apc("a=t,f=100,i=2,m=1,q=2;DDDD"), apc("m=0,q=2;EEEE")])
    expect(rest).toBe("")
  })

  it("drops a continuation with no transfer in flight (replay starting mid-image)", () => {
    const { forwarded, rest } = run([`${apc("m=1;BBBB")}${apc("m=0;CCCC")}text`])
    expect(forwarded).toEqual([])
    expect(rest).toBe("text")
  })

  it("does not carry a dropped transfer over a new command", () => {
    const { forwarded } = run([apc("a=T,f=100,i=1,m=1;AAAA"), apc("a=t,f=100,i=2;DDDD")])
    expect(forwarded).toEqual([apc("a=t,f=100,i=2,q=2;DDDD")])
  })

  it("reassembles an APC split at every possible byte boundary", () => {
    const cmd = apc("a=t,f=100,i=3,m=0;QUJDRA==")
    const stream = `pre${cmd}post`
    for (let cut = 1; cut < stream.length; cut++) {
      const { forwarded, rest } = run([stream.slice(0, cut), stream.slice(cut)])
      expect(forwarded, `cut at ${cut}`).toEqual([apc("a=t,f=100,i=3,m=0,q=2;QUJDRA==")])
      expect(rest, `cut at ${cut}`).toBe("prepost")
    }
  })

  it("reassembles one APC across many one-byte chunks", () => {
    const cmd = apc("a=p,U=1,i=3")
    const { forwarded, rest } = run([...`a${cmd}b`].map((c) => c))
    expect(forwarded).toEqual([apc("a=p,U=1,i=3,q=2")])
    expect(rest).toBe("ab")
  })

  it("accepts bytes as well as strings and splits multi-byte text intact", () => {
    const bytes = Buffer.from(`é${apc("a=p,U=1,i=3")}\u{10EEEE}`)
    const { forwarded, rest } = run([bytes.subarray(0, 1), bytes.subarray(1, 9), bytes.subarray(9)])
    expect(forwarded).toEqual([apc("a=p,U=1,i=3,q=2")])
    expect(rest).toBe("é\u{10EEEE}")
  })

  it("leaves other escape sequences alone, including a lone trailing ESC that resolves later", () => {
    const stream = "\x1b[31mred\x1b[0m\x1b_Xnot-graphics\x1b\\\x1b]0;title\x07"
    expect(run([stream])).toEqual({ forwarded: [], rest: stream })
    expect(run(["a\x1b", "[1mb"]).rest).toBe("a\x1b[1mb")
  })

  it("returns the same chunk object when there is nothing to lift", () => {
    const filter = new KittyGraphicsFilter()
    const bytes = new Uint8Array([104, 105])
    expect(filter.push(bytes, () => {})).toBe(bytes)
    expect(filter.push("plain", () => {})).toBe("plain")
  })

  it("swallows an abandoned oversized APC up to its terminator without leaking its payload", () => {
    const filter = new KittyGraphicsFilter()
    const sent: Buffer[] = []
    const big = Buffer.alloc(17 * 1024 * 1024, 0x41)
    const first = filter.push(Buffer.concat([Buffer.from("ok\x1b_Ga=t,f=100,i=1,m=0;"), big]), (b) => sent.push(b))
    const second = filter.push(Buffer.from("AAAA\x1b\\tail"), (b) => sent.push(b))
    expect(Buffer.from(first).toString()).toBe("ok")
    expect(Buffer.from(second).toString()).toBe("tail")
    expect(sent).toEqual([])
  })
})

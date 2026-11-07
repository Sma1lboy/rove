import { expect, test } from "bun:test"
import { probe } from "../kit.ts"
import { xLength } from "../src/xcount.ts"

test("xLength follows X weighting: CJK 2, URL 23, emoji 2", () => {
  expect(xLength("hello")).toBe(5)
  expect(xLength("你好")).toBe(4)
  expect(xLength("see https://rove.run/docs?a=1 now")).toBe(4 + 23 + 4)
  expect(xLength("👍🏽")).toBe(2)
  expect(xLength("中".repeat(140))).toBe(280)
})

test("probe reads mvhd duration and codec inside moov only", () => {
  const box = (type: string, body: Uint8Array) => {
    const b = new Uint8Array(8 + body.length)
    new DataView(b.buffer).setUint32(0, b.length)
    b.set(new TextEncoder().encode(type), 4)
    b.set(body, 8)
    return b
  }
  const mvhd = new Uint8Array(100)
  new DataView(mvhd.buffer).setUint32(12, 1000) // timescale
  new DataView(mvhd.buffer).setUint32(16, 42500) // duration
  const cat = (...a: Uint8Array[]) => Uint8Array.from(a.flatMap((x) => [...x]))
  const mdat = box("mdat", new TextEncoder().encode("hvc1 noise in media data"))
  const moov = box("moov", cat(box("mvhd", mvhd), box("stsd", new TextEncoder().encode("....avc1"))))
  expect(probe(cat(box("ftyp", new Uint8Array(8)), mdat, moov))).toEqual({ duration: 42.5, codec: "avc1" })
  expect(probe(mdat)).toBeNull()
})

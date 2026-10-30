import { afterEach, expect, test } from "bun:test"
import { KittyImages, placeholderDiacritics, resolvePlaceholder } from "../src/term-kitty.ts"

const apc = (body: string) => `\x1b_G${body}\x1b\\`
const decoded: Uint8Array[] = []
const realBitmap = globalThis.createImageBitmap
globalThis.createImageBitmap = (async (blob: Blob) => {
  decoded.push(new Uint8Array(await blob.arrayBuffer()))
  return { width: 20, height: 10, close() {} }
}) as unknown as typeof createImageBitmap
afterEach(() => {
  decoded.length = 0
})
process.on("exit", () => {
  globalThis.createImageBitmap = realBitmap
})

/** Feed `text` to a fresh store `step` bytes at a time, so every sequence splits somewhere; resolves once `ready` holds. */
async function feed(
  text: string,
  step: number,
  ready: (store: KittyImages) => boolean = () => true,
): Promise<KittyImages> {
  const { promise, resolve } = Promise.withResolvers<void>()
  const store: KittyImages = new KittyImages(() => {
    if (ready(store)) resolve()
  })
  const bytes = new TextEncoder().encode(text)
  for (let i = 0; i < bytes.length; i += step) store.push(bytes.subarray(i, i + step))
  if (ready(store)) resolve()
  await promise
  return store
}

test("a chunked PNG transmit and its virtual placement survive any split of the stream", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const stream = `text${apc(`a=t,f=100,i=7,m=1,q=2;${png.slice(0, 16)}`)}${apc(`m=0;${png.slice(16)}`)}${apc("a=p,U=1,i=7,c=4,r=2,q=2")}more`
  for (const step of [1, 3, 7, stream.length]) {
    const store = await feed(stream, step, (s) => s.images.get(7)?.bitmap != null)
    expect(decoded.at(-1)).toEqual(Uint8Array.from(atob(png), (c) => c.charCodeAt(0)))
    const image = store.images.get(7)
    expect([image?.cols, image?.rows, image?.bitmap?.width]).toEqual([4, 2, 20])
  }
})

test("a delete by id forgets the image; an escape other than ST abandons the command", async () => {
  const store = await feed(
    `${apc("a=T,f=100,i=3,U=1,c=2,r=1;AAAA")}${apc("a=d,d=i,i=3")}\x1b_Ga=p,U=1,i=9,c=1\x1b[0m`,
    2,
  )
  expect(store.images.size).toBe(0)
})

test("placeholder cells take their row and column from diacritics, else continue the cell to their left", () => {
  // U+0305 = 0, U+030D = 1, U+030E = 2 in Kitty's table.
  const first = resolvePlaceholder(0x123456, placeholderDiacritics("\u{10EEEE}\u030D\u0305") ?? [], null)
  expect(first).toEqual({ id: 0x123456, row: 1, col: 0 })
  const bare = resolvePlaceholder(0x123456, placeholderDiacritics("\u{10EEEE}") ?? [], first)
  expect(bare).toEqual({ id: 0x123456, row: 1, col: 1 })
  // A third diacritic is the id's top byte.
  expect(resolvePlaceholder(5, placeholderDiacritics("\u{10EEEE}\u0305\u0305\u030E") ?? [], null).id).toBe(0x02000005)
  expect(placeholderDiacritics("x\u0305")).toBeNull()
})

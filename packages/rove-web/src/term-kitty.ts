/**
 * Kitty graphics for the web terminal, Unicode-placeholder form only (what omp emits under
 * `PI_KITTY_PLACEHOLDERS`). xterm.js swallows every APC, so the stream is tapped before
 * `term.write`, never rewritten: transmits fill an image store, virtual placements give an
 * image its cell box, and the placeholder cells xterm keeps are painted by `term-images.ts`.
 */

export interface KittyImage {
  /** Cell box from the placement (`c`, `r`); null until one arrives. */
  cols: number | null
  rows: number | null
  bitmap: ImageBitmap | null
}

/** Newest images kept; an id seen again moves to the back. */
const MAX_IMAGES = 64
/** An APC past this is abandoned (its tail still reaches xterm, which drops it). */
const MAX_APC_BYTES = 32 * 1024 * 1024

const ESC = 0x1b
const decoder = new TextDecoder("latin1")

function parseKeys(control: string): Map<string, string> {
  const keys = new Map<string, string>()
  for (const pair of control.split(",")) {
    const eq = pair.indexOf("=")
    if (eq > 0) keys.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  return keys
}

function base64Bytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decodeImage(keys: ReadonlyMap<string, string>, b64: string): Promise<ImageBitmap | null> {
  let bytes = base64Bytes(b64)
  if (keys.get("o") === "z") bytes = await inflate(bytes)
  const format = keys.get("f") ?? "32"
  if (format === "100") return createImageBitmap(new Blob([bytes], { type: "image/png" }))
  const w = Number(keys.get("s"))
  const h = Number(keys.get("v"))
  const channels = format === "24" ? 3 : format === "32" ? 4 : 0
  if (!channels || !(w > 0 && h > 0) || bytes.length < w * h * channels) return null
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < w * h; p++) {
    rgba[p * 4] = bytes[p * channels] as number
    rgba[p * 4 + 1] = bytes[p * channels + 1] as number
    rgba[p * 4 + 2] = bytes[p * channels + 2] as number
    rgba[p * 4 + 3] = channels === 4 ? (bytes[p * 4 + 3] as number) : 255
  }
  return createImageBitmap(new ImageData(rgba, w, h))
}

export class KittyImages {
  readonly images = new Map<number, KittyImage>()
  /** Inside `ESC _`: the body so far; null outside one. */
  private apc: Uint8Array[] | null = null
  private apcBytes = 0
  /** The previous chunk ended on ESC (an opener or the terminator, split). */
  private escPending = false
  /** A chunked transmit (`m=1`) still receiving: its first chunk's keys and the base64 so far. */
  private upload: { keys: Map<string, string>; parts: string[] } | null = null

  constructor(private readonly changed: () => void) {}

  /** Observe output headed for `term.write`; the bytes themselves are left alone. */
  push(bytes: Uint8Array): void {
    let i = 0
    if (this.escPending && bytes.length > 0) {
      this.escPending = false
      if (this.apc && bytes[0] === 0x5c /* \ */) {
        this.finish()
        i = 1
      } else {
        this.apc = null
        if (bytes[0] === 0x5f /* _ */) {
          this.apc = []
          this.apcBytes = 0
          i = 1
        }
      }
    }
    while (i < bytes.length) {
      const esc = bytes.indexOf(ESC, i)
      if (this.apc) {
        if (esc === -1) {
          this.append(bytes.subarray(i))
          return
        }
        this.append(bytes.subarray(i, esc))
        if (esc + 1 >= bytes.length) {
          this.escPending = true
          return
        }
        // Any other escape aborts the string, as in xterm's parser.
        if (bytes[esc + 1] === 0x5c) this.finish()
        else this.apc = null
        i = esc + 2
        continue
      }
      if (esc === -1) return
      if (esc + 1 >= bytes.length) {
        this.escPending = true
        return
      }
      if (bytes[esc + 1] === 0x5f) {
        this.apc = []
        this.apcBytes = 0
        i = esc + 2
      } else i = esc + 1
    }
  }

  private append(part: Uint8Array): void {
    if (!this.apc || part.length === 0) return
    this.apcBytes += part.length
    if (this.apcBytes > MAX_APC_BYTES) this.apc = null
    // A copy: the caller's buffer is handed to xterm and may be reused.
    else this.apc.push(part.slice())
  }

  private finish(): void {
    const parts = this.apc
    this.apc = null
    if (!parts) return
    const body = parts.map((p) => decoder.decode(p)).join("")
    if (body[0] !== "G") return
    const semi = body.indexOf(";")
    const keys = parseKeys(semi === -1 ? body.slice(1) : body.slice(1, semi))
    this.command(keys, semi === -1 ? "" : body.slice(semi + 1))
  }

  private command(keys: Map<string, string>, payload: string): void {
    // A follow-up chunk carries only `m` (and `q`).
    if (this.upload && [...keys.keys()].every((k) => k === "m" || k === "q")) {
      this.upload.parts.push(payload)
      if (keys.get("m") !== "1") {
        const { keys: first, parts } = this.upload
        this.upload = null
        this.transmitted(first, parts.join(""))
      }
      return
    }
    this.upload = null
    const action = keys.get("a") ?? "t"
    if (action === "t" || action === "T") {
      if ((keys.get("t") ?? "d") !== "d") return
      if (keys.get("m") === "1") this.upload = { keys, parts: [payload] }
      else this.transmitted(keys, payload)
    } else if (action === "p") this.placed(keys)
    else if (action === "d") this.deleted(keys)
  }

  private entry(id: number): KittyImage {
    const image = this.images.get(id) ?? { cols: null, rows: null, bitmap: null }
    this.images.delete(id)
    this.images.set(id, image)
    for (const old of this.images.keys()) {
      if (this.images.size <= MAX_IMAGES) break
      this.images.get(old)?.bitmap?.close()
      this.images.delete(old)
    }
    return image
  }

  private transmitted(keys: ReadonlyMap<string, string>, b64: string): void {
    const id = Number(keys.get("i"))
    if (!(id > 0)) return
    const image = this.entry(id)
    if (keys.get("a") === "T") this.placed(keys)
    decodeImage(keys, b64)
      .then((bitmap) => {
        if (!bitmap) return
        if (this.images.get(id) !== image) return bitmap.close()
        image.bitmap?.close()
        image.bitmap = bitmap
        this.changed()
      })
      .catch(() => {})
  }

  private placed(keys: ReadonlyMap<string, string>): void {
    const id = Number(keys.get("i"))
    if (!(id > 0) || keys.get("U") !== "1") return
    const image = this.entry(id)
    const cols = Number(keys.get("c"))
    const rows = Number(keys.get("r"))
    image.cols = cols > 0 ? cols : null
    image.rows = rows > 0 ? rows : null
    this.changed()
  }

  private deleted(keys: ReadonlyMap<string, string>): void {
    const what = keys.get("d") ?? "a"
    if (what !== "i" && what !== "I") return
    const id = Number(keys.get("i"))
    this.images.get(id)?.bitmap?.close()
    if (this.images.delete(id)) this.changed()
  }

  dispose(): void {
    for (const image of this.images.values()) image.bitmap?.close()
    this.images.clear()
  }
}

/** The placeholder character a Kitty-placeholder cell holds. */
export const PLACEHOLDER = 0x10eeee

/** Kitty's `rowcolumn-diacritics.txt`, as inclusive ranges: the n-th codepoint encodes the number n. */
const DIACRITIC_RANGES = `305-305 30d-30e 310-310 312-312 33d-33f 346-346 34a-34c 350-352 357-357 35b-35b 363-36f 483-487
592-595 597-599 59c-5a1 5a8-5a9 5ab-5ac 5af-5af 5c4-5c4 610-617 657-65b 65d-65e 6d6-6dc 6df-6e2
6e4-6e4 6e7-6e8 6eb-6ec 730-730 732-733 735-736 73a-73a 73d-73d 73f-741 743-743 745-745 747-747
749-74a 7eb-7f1 7f3-7f3 816-819 81b-823 825-827 829-82d 951-951 953-954 f82-f83 f86-f87 135d-135f
17dd-17dd 193a-193a 1a17-1a17 1a75-1a7c 1b6b-1b6b 1b6d-1b73 1cd0-1cd2 1cda-1cdb 1ce0-1ce0 1dc0-1dc1 1dc3-1dc9 1dcb-1dcc
1dd1-1de6 1dfe-1dfe 20d0-20d1 20d4-20d7 20db-20dc 20e1-20e1 20e7-20e7 20e9-20e9 20f0-20f0 2cef-2cf1 2de0-2dff a66f-a66f
a67c-a67d a6f0-a6f1 a8e0-a8f1 aab0-aab0 aab2-aab3 aab7-aab8 aabe-aabf aac1-aac1 fe20-fe26 10a0f-10a0f 10a38-10a38 1d185-1d189
1d1aa-1d1ad 1d242-1d244`

const DIACRITIC_INDEX = (() => {
  const index = new Map<number, number>()
  for (const range of DIACRITIC_RANGES.split(/\s+/)) {
    const [from, to] = range.split("-").map((h) => Number.parseInt(h, 16)) as [number, number]
    for (let cp = from; cp <= to; cp++) index.set(cp, index.size)
  }
  return index
})()

/** One placeholder cell's own encoding: the numbers its diacritics carry (row, column, id's top byte), in order. */
export function placeholderDiacritics(chars: string): number[] | null {
  if (chars.codePointAt(0) !== PLACEHOLDER) return null
  const numbers: number[] = []
  for (const ch of chars.slice(2)) {
    const n = DIACRITIC_INDEX.get(ch.codePointAt(0) as number)
    if (n === undefined) break
    numbers.push(n)
  }
  return numbers
}

export interface PlaceholderCell {
  readonly id: number
  readonly row: number
  readonly col: number
}

/**
 * A cell's position in its image, completing missing diacritics from the cell to its left the
 * way Kitty does: no column means the next column, no row means the same row.
 */
export function resolvePlaceholder(
  fgId: number,
  numbers: readonly number[],
  left: PlaceholderCell | null,
): PlaceholderCell {
  const id = numbers[2] !== undefined ? (fgId | (numbers[2] << 24)) >>> 0 : fgId
  const continues = left !== null && left.id === id
  const row = numbers[0] ?? (continues ? left.row : 0)
  const col = numbers[1] ?? (continues && left.row === row ? left.col + 1 : 0)
  return { id, row, col }
}

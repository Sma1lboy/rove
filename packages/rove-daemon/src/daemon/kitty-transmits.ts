/**
 * The Kitty image uploads a PTY child sent, kept out of the ring. One screenshot's base64 is larger
 * than the whole ring, so a full replay would otherwise keep the placements and placeholder cells
 * but never the image they draw. A full replay sends these first; a delta never needs them.
 */

/** Newest images kept per session; older ones are dropped first. */
const MAX_IMAGES = 8
/** Raw bytes kept per session; one upload past this is not kept at all. */
const MAX_BYTES = 16 * 1024 * 1024

const ESC = 0x1b
const OPEN = Buffer.from("\x1b_")
const CLOSE = Buffer.from("\x1b\\")

function parseKeys(control: string): Map<string, string> {
  const keys = new Map<string, string>()
  for (const pair of control.split(",")) {
    const eq = pair.indexOf("=")
    if (eq > 0) keys.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  return keys
}

export class KittyTransmits {
  /** Image id → its upload's APCs, raw; Map order is age. */
  private readonly images = new Map<number, Buffer>()
  private bytes = 0
  /** Inside `ESC _`: the body so far; null outside one. */
  private apc: Buffer[] | null = null
  private apcBytes = 0
  /** The previous chunk ended on ESC (an opener or the terminator, split). */
  private escPending = false
  /** A chunked upload (`m=1`) still arriving. */
  private upload: { id: number; parts: Buffer[]; bytes: number } | null = null

  /** Observe one chunk of child output. */
  push(buf: Buffer): void {
    let i = 0
    if (this.escPending && buf.length > 0) {
      this.escPending = false
      if (this.apc && buf[0] === 0x5c /* \ */) {
        this.finish()
        i = 1
      } else {
        this.apc = null
        if (buf[0] === 0x5f /* _ */) this.open()
        if (buf[0] === 0x5f || buf[0] === 0x63 /* c, RIS */) i = 1
        if (buf[0] === 0x63) this.clear()
      }
    }
    while (i < buf.length) {
      if (this.apc) {
        const esc = buf.indexOf(ESC, i)
        if (esc === -1) {
          this.append(buf.subarray(i))
          return
        }
        this.append(buf.subarray(i, esc))
        if (esc + 1 >= buf.length) {
          this.escPending = true
          return
        }
        // Any other escape aborts the string, as in xterm's parser.
        if (buf[esc + 1] === 0x5c) this.finish()
        else this.apc = null
        i = esc + 2
        continue
      }
      const esc = buf.indexOf(ESC, i)
      if (esc === -1) return
      if (esc + 1 >= buf.length) {
        this.escPending = true
        return
      }
      const next = buf[esc + 1]
      if (next === 0x5f) this.open()
      else if (next === 0x63) this.clear()
      i = esc + 2
    }
  }

  /** Every kept upload, oldest first, ready to precede a full replay. */
  replay(): Buffer {
    return Buffer.concat([...this.images.values()])
  }

  private open(): void {
    this.apc = []
    this.apcBytes = 0
  }

  private append(part: Buffer): void {
    if (!this.apc || part.length === 0) return
    this.apcBytes += part.length
    if (this.apcBytes > MAX_BYTES) this.apc = null
    // A copy: the chunk stays in the ring, which trims it independently.
    else this.apc.push(Buffer.from(part))
  }

  private finish(): void {
    const body = this.apc ? Buffer.concat(this.apc) : null
    this.apc = null
    if (!body || body[0] !== 0x47 /* G */) return
    const semi = body.indexOf(0x3b /* ; */)
    const keys = parseKeys(body.subarray(1, semi === -1 ? body.length : semi).toString("latin1"))
    const raw = Buffer.concat([OPEN, body, CLOSE])
    // A follow-up chunk carries only `m` (and `q`).
    if (this.upload && [...keys.keys()].every((k) => k === "m" || k === "q")) {
      this.upload.parts.push(raw)
      this.upload.bytes += raw.length
      if (this.upload.bytes > MAX_BYTES) this.upload = null
      else if (keys.get("m") !== "1") {
        const { id, parts } = this.upload
        this.upload = null
        this.keep(id, Buffer.concat(parts))
      }
      return
    }
    this.upload = null
    const action = keys.get("a") ?? "t"
    const id = Number(keys.get("i"))
    if ((action === "t" || action === "T") && (keys.get("t") ?? "d") === "d" && id > 0) {
      if (keys.get("m") === "1") this.upload = { id, parts: [raw], bytes: raw.length }
      else this.keep(id, raw)
    } else if (action === "d" && (keys.get("d") === "i" || keys.get("d") === "I")) this.drop(id)
  }

  private keep(id: number, raw: Buffer): void {
    this.drop(id)
    this.images.set(id, raw)
    this.bytes += raw.length
    for (const [old, kept] of this.images) {
      if (this.images.size <= MAX_IMAGES && this.bytes <= MAX_BYTES) break
      this.images.delete(old)
      this.bytes -= kept.length
    }
  }

  private drop(id: number): void {
    const kept = this.images.get(id)
    if (!kept) return
    this.images.delete(id)
    this.bytes -= kept.length
  }

  /** RIS: the terminal forgets every image. */
  private clear(): void {
    this.images.clear()
    this.bytes = 0
    this.upload = null
  }
}

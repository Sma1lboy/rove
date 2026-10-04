/**
 * Lifts Kitty graphics commands (`ESC _ G … ESC \`) out of a pane's byte stream.
 * `@xterm/headless` drops them, so images never reach the real terminal; the
 * Unicode placeholder cells they pair with survive as plain text. Only
 * commands that draw the same way from any cursor position are forwarded, and
 * every one is forced quiet so the outer terminal never replies into the GUI's
 * stdin. Pane output is untrusted (`cat` of any file), hence the allow-list.
 */

const OPEN = Buffer.from("\x1b_G")
const ST = Buffer.from("\x1b\\")
/** A pending partial APC past this is abandoned and swallowed up to its terminator. */
const MAX_PENDING_BYTES = 16 * 1024 * 1024
/** Control data is `k=v` pairs; anything else is not a command we understand. */
const CONTROL_SHAPE = /^[A-Za-z0-9=,+.-]*$/

type Decision = "forward" | "drop"

function parseControl(control: string): Map<string, string> | null {
  if (!CONTROL_SHAPE.test(control)) return null
  const keys = new Map<string, string>()
  for (const pair of control.split(",")) {
    if (pair.length === 0) continue
    const eq = pair.indexOf("=")
    if (eq <= 0) return null
    keys.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  return keys
}

/** A follow-up chunk of a chunked transfer carries only `m` (and `q`). */
function isContinuation(keys: ReadonlyMap<string, string>): boolean {
  for (const key of keys.keys()) if (key !== "m" && key !== "q") return false
  return true
}

/**
 * Position-independent commands only: transmits, virtual (`U=1`) placements,
 * deletes by image id. Direct placements draw at the GUI's own cursor,
 * delete-all wipes other panes' pictures, and queries would be answered to the
 * GUI; file/shm mediums make the outer terminal read local paths.
 */
function classify(keys: ReadonlyMap<string, string>): Decision {
  const medium = keys.get("t")
  if (medium !== undefined && medium !== "d") return "drop"
  const virtual = keys.get("U") === "1"
  switch (keys.get("a") ?? "t") {
    case "t":
      return "forward"
    case "T":
    case "p":
      return virtual ? "forward" : "drop"
    case "d": {
      const target = keys.get("d") ?? "a"
      return (target === "i" || target === "I") && keys.has("i") ? "forward" : "drop"
    }
    default:
      return "drop"
  }
}

/** Rebuild the command with `q=2` (suppress all replies), payload bytes untouched. */
function forceQuiet(apc: Buffer, keys: ReadonlyMap<string, string>, payloadStart: number): Buffer {
  const control = [...[...keys].filter(([key]) => key !== "q").map(([key, value]) => `${key}=${value}`), "q=2"].join(
    ",",
  )
  return Buffer.concat([OPEN, Buffer.from(control), apc.subarray(payloadStart)])
}

/** Length (0-2) of a trailing `ESC` / `ESC _` that may be the start of an APC split across chunks. */
function partialOpenerLength(bytes: Buffer, from: number): number {
  const end = bytes.length
  if (end - from >= 2 && bytes[end - 2] === 0x1b && bytes[end - 1] === 0x5f) return 2
  if (end - from >= 1 && bytes[end - 1] === 0x1b) return 1
  return 0
}

function asBuffer(data: string | Uint8Array): Buffer {
  if (typeof data === "string") return Buffer.from(data)
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

export class KittyGraphicsFilter {
  /** Bytes held back from the previous chunk: a partial APC or a partial introducer. */
  private pending: Buffer | null = null
  /** Inside an oversized APC that was abandoned: drop bytes up to its terminator. */
  private discarding = false
  /** Decision for a chunked transfer still in flight (`m=1` seen, `m=0` not yet). */
  private transfer: Decision | null = null

  /**
   * Returns what the terminal emulator should parse: `data` minus every graphics
   * APC. `forward` receives each accepted command, rewritten quiet. Non-graphics
   * APCs and all other bytes pass through untouched. Same object comes back
   * when the chunk holds no graphics APC.
   */
  push(data: string | Uint8Array, forward: (apc: Buffer) => void): string | Uint8Array {
    if (this.pending === null && !this.discarding && !this.mayContainApc(data)) return data
    const incoming = asBuffer(data)
    const bytes = this.pending === null ? incoming : Buffer.concat([this.pending, incoming])
    this.pending = null
    const out: Buffer[] = []
    let pos = 0
    if (this.discarding) {
      const end = bytes.indexOf(ST)
      if (end < 0) return Buffer.alloc(0)
      this.discarding = false
      pos = end + ST.length
    }
    while (pos < bytes.length) {
      const open = bytes.indexOf(OPEN, pos)
      if (open < 0) {
        const keep = partialOpenerLength(bytes, pos)
        out.push(bytes.subarray(pos, bytes.length - keep))
        if (keep > 0) this.pending = Buffer.from(bytes.subarray(bytes.length - keep))
        break
      }
      out.push(bytes.subarray(pos, open))
      const end = bytes.indexOf(ST, open + OPEN.length)
      if (end < 0) {
        const rest = bytes.subarray(open)
        if (rest.length > MAX_PENDING_BYTES) {
          this.discarding = true
          this.transfer = "drop"
        } else {
          this.pending = Buffer.from(rest)
        }
        break
      }
      this.dispatch(bytes.subarray(open, end + ST.length), forward)
      pos = end + ST.length
    }
    return out.length === 1 ? (out[0] as Buffer) : Buffer.concat(out)
  }

  /** Cheap gate for the hot path: no graphics introducer and no split one at the tail. */
  private mayContainApc(data: string | Uint8Array): boolean {
    if (typeof data === "string") return data.includes("\x1b_G") || data.endsWith("\x1b") || data.endsWith("\x1b_")
    const bytes = asBuffer(data)
    return bytes.indexOf(OPEN) >= 0 || partialOpenerLength(bytes, 0) > 0
  }

  private dispatch(apc: Buffer, forward: (apc: Buffer) => void): void {
    const semi = apc.indexOf(0x3b, OPEN.length)
    const payloadStart = semi < 0 ? apc.length - ST.length : semi
    const keys = parseControl(apc.toString("latin1", OPEN.length, payloadStart))
    if (keys === null) {
      this.transfer = null
      return
    }
    const decision: Decision = isContinuation(keys) ? (this.transfer ?? "drop") : classify(keys)
    this.transfer = keys.get("m") === "1" ? decision : null
    if (decision === "forward") forward(forceQuiet(apc, keys, payloadStart))
  }
}

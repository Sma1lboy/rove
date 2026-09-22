/**
 * Ask the terminal for its cell size in pixels, the prerequisite for placing a
 * pixel-sized payload in a cell grid (`ceil(height / cellHeight)` rows). A pane
 * can't ask for itself (its tty is a PTY slave and the outer emulator's
 * identity is scrubbed), so the process owning the real tty asks once at boot
 * and reports to the daemon.
 *
 * Query `CSI 16 t`, reply `CSI 6 ; <height> ; <width> t`. Zeros or silence →
 * `null`, deliberately with no fallback constant: a guessed size puts a picture
 * in the wrong place at the wrong scale, worse than not drawing it.
 */

import type { CellPixelSize } from "@sma1lboy/kobe-daemon/daemon/protocol"

export type { CellPixelSize }

/**
 * `CSI 16 t` then DA1 (`CSI c`) as a fence: every terminal answers DA1, so DA1
 * with no size reply ahead of it is a definite "unsupported" in milliseconds
 * instead of a timeout every boot. Same trick as `doctor-terminal.ts`'s kitty probe.
 */
const QUERY = "\x1b[16t\x1b[c"

/** `ESC [ 6 ; <height> ; <width> t`, anywhere in what we read back. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching a raw ESC-prefixed terminal reply is the whole point
const REPLY = /\x1b\[6;(\d+);(\d+)t/

/** The DA1 fence's own reply: `ESC [ ? <params> c`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: same — raw DA1 escape reply
const DA1 = /\x1b\[\?[\d;]*c/

/** Pure, so the parse is testable: replies in pieces, amid typed bytes, or all zeros. */
export function parseCellPixelReply(text: string): CellPixelSize | null {
  const match = REPLY.exec(text)
  if (!match) return null
  const height = Number(match[1])
  const width = Number(match[2])
  // Zeros = no pixel geometry (a capability answer), not a zero-width cell.
  if (!(width > 0 && height > 0)) return null
  return { width, height }
}

/** Just enough of a stream to run the query against; `process.stdin` satisfies it. */
export interface CellQueryInput {
  isTTY?: boolean
  isRaw?: boolean
  setRawMode?(mode: boolean): unknown
  resume(): unknown
  pause(): unknown
  isPaused(): boolean
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown
  off(event: "data", listener: (chunk: Buffer | string) => void): unknown
}

/** Just enough of `process.stdout` to write the query to. */
export interface CellQueryOutput {
  isTTY?: boolean
  write(chunk: string): unknown
}

/**
 * Call BEFORE the renderer takes stdin: raw mode is set briefly and the exact
 * mode and flow state restored. Costs `timeoutMs` once at boot on a silent
 * terminal. Non-reply bytes are dropped; at boot there's no key handler yet.
 */
export async function queryCellPixelSize(opts: {
  readonly stdin: CellQueryInput
  readonly stdout: CellQueryOutput
  readonly timeoutMs?: number
}): Promise<CellPixelSize | null> {
  const { stdin, stdout } = opts
  // Both ends must be the terminal: piped stdin can't carry the reply, and a
  // redirected stdout would write the query into a file.
  const setRawMode = stdin.setRawMode
  if (!stdin.isTTY || !stdout.isTTY || typeof setRawMode !== "function") return null

  const wasRaw = stdin.isRaw === true
  const wasPaused = stdin.isPaused()
  return await new Promise<CellPixelSize | null>((resolve) => {
    let seen = ""
    let settled = false
    const onData = (chunk: Buffer | string): void => {
      // Replies can split across chunks.
      seen += typeof chunk === "string" ? chunk : chunk.toString("latin1")
      const parsed = parseCellPixelReply(seen)
      // Settle on the SHAPE of a reply: `CSI 6;0;0t` parses null but HAS
      // answered, and a lone DA1 is a definite no; waiting would add the full
      // delay to every boot on those terminals.
      if (parsed || REPLY.test(seen) || DA1.test(seen)) finish(parsed)
    }
    const finish = (result: CellPixelSize | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdin.off("data", onData)
      // `setRawMode` resumes the stream as a side effect; a stdin left flowing
      // would swallow the renderer's first keys.
      try {
        setRawMode.call(stdin, wasRaw)
      } catch {
        // Not worth failing boot over; the answer is still good.
      }
      if (wasPaused) stdin.pause()
      resolve(result)
    }
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? 120)
    // Never hold the process open for a terminal that will not answer.
    if (typeof timer === "object" && "unref" in timer) timer.unref()

    stdin.on("data", onData)
    try {
      setRawMode.call(stdin, true)
    } catch {
      finish(null)
      return
    }
    stdin.resume()
    stdout.write(QUERY)
  })
}

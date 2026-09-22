/**
 * Ask the terminal how big one cell is, in pixels.
 *
 * Rove has never known this about itself at any layer, and it is the
 * prerequisite for placing anything sized in pixels inside a grid sized in
 * cells: a payload of a known pixel height covers `ceil(height / cellHeight)`
 * rows, and nothing below the TUI can work that out. A pane cannot ask on its
 * own behalf either — its `tty(1)` is its PTY slave, and the outer emulator's
 * identity is scrubbed from its environment — so the process that owns the
 * real tty asks once, at boot, and reports the answer.
 *
 * The query is `CSI 16 t`; the reply is `CSI 6 ; <height> ; <width> t`. A
 * terminal that does not implement it answers zeros or stays silent, and both
 * are reported as `null`. There is deliberately no fallback constant: a
 * guessed cell size does not degrade a picture, it puts it in the wrong place
 * at the wrong scale, which is worse than not drawing one.
 *
 * Same shape as `cli/doctor-terminal.ts`'s kitty-keyboard probe, DA1 fence
 * included, and separate from it on purpose: that one is a `rove doctor`
 * section that prints a line, this one runs on the boot path of every TUI and
 * hands its answer to the daemon.
 */

import type { CellPixelSize } from "@sma1lboy/kobe-daemon/daemon/protocol"

export type { CellPixelSize }

/**
 * `CSI 16 t` (XTWINOPS "report cell size in pixels") followed by `CSI c`
 * (DA1) as a fence. EVERY terminal answers DA1, so a DA1 reply with no size
 * reply in front of it is a definite "does not implement the query" — which
 * settles in milliseconds instead of waiting out the timeout on every boot in
 * such a terminal. Borrowed from `doctor-terminal.ts`'s kitty probe.
 */
const QUERY = "\x1b[16t\x1b[c"

/** `ESC [ 6 ; <height> ; <width> t`, anywhere in what we read back. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching a raw ESC-prefixed terminal reply is the whole point
const REPLY = /\x1b\[6;(\d+);(\d+)t/

/** The DA1 fence's own reply: `ESC [ ? <params> c`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: same — raw DA1 escape reply
const DA1 = /\x1b\[\?[\d;]*c/

/**
 * Extract a cell size from raw terminal input, or `null`.
 *
 * Split out from the I/O so the parse is testable without a tty: the
 * interesting cases are a reply arriving in pieces, a reply arriving amid
 * unrelated bytes the user typed, and the zeros a terminal answers when it has
 * no pixel geometry to report.
 */
export function parseCellPixelReply(text: string): CellPixelSize | null {
  const match = REPLY.exec(text)
  if (!match) return null
  const height = Number(match[1])
  const width = Number(match[2])
  // A terminal with no pixel geometry answers the query with zeros rather
  // than declining it. That is "no capability", not a cell zero pixels wide.
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
 * Measure one cell, or report `null`.
 *
 * Call this BEFORE the renderer takes stdin: it briefly puts the terminal in
 * raw mode to read the reply, and restores the exact mode and flow state it
 * found. A terminal that answers does so in a few milliseconds; one that does
 * not costs `timeoutMs` once, at boot. Bytes read during that window that are
 * not the reply are dropped — at boot there is no key handler to hand them to
 * yet, which is the reason to run the query before one exists rather than
 * after.
 */
export async function queryCellPixelSize(opts: {
  readonly stdin: CellQueryInput
  readonly stdout: CellQueryOutput
  readonly timeoutMs?: number
}): Promise<CellPixelSize | null> {
  const { stdin, stdout } = opts
  // Both ends must be the terminal: a piped stdin cannot carry the reply, and
  // a redirected stdout would write the query into a file.
  const setRawMode = stdin.setRawMode
  if (!stdin.isTTY || !stdout.isTTY || typeof setRawMode !== "function") return null

  const wasRaw = stdin.isRaw === true
  const wasPaused = stdin.isPaused()
  return await new Promise<CellPixelSize | null>((resolve) => {
    let seen = ""
    let settled = false
    const onData = (chunk: Buffer | string): void => {
      // The reply can be split across chunks, so accumulate rather than
      // matching each chunk on its own.
      seen += typeof chunk === "string" ? chunk : chunk.toString("latin1")
      const parsed = parseCellPixelReply(seen)
      // Settle on the SHAPE of a reply, not on a value. A `CSI 6;0;0t` answer
      // parses as `null` but HAS answered, and the DA1 fence coming back alone
      // is a definite no — waiting out the timeout for either would put the
      // full delay on every boot in the terminals that give them.
      if (parsed || REPLY.test(seen) || DA1.test(seen)) finish(parsed)
    }
    const finish = (result: CellPixelSize | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdin.off("data", onData)
      // Restore exactly what we found. `setRawMode` resumes the stream as a
      // side effect, so the pause state has to be put back too — a stdin left
      // flowing here would swallow the first keys the renderer expects.
      try {
        setRawMode.call(stdin, wasRaw)
      } catch {
        // A stdin that refuses the mode change on the way out is not worth
        // failing boot over; the query's answer is still good.
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

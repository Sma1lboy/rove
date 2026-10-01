/**
 * The terminal modes a PTY child has set, tracked by the host from its raw
 * output. Two uses:
 *
 *   - Replay: a reattaching emulator only sees the ring's tail, so a mode set
 *     before the ring's first byte (an engine's startup `?1000h`) is lost and
 *     the wheel scrolls Rove's local buffer instead of reaching the app.
 *     {@link terminalModePreamble} re-sets the ring-start state before the
 *     replay.
 *   - Queries: with no emulator attached, nobody answers DA1/DECRQM, and the
 *     app decides the terminal lacks the feature. The host answers them as
 *     the TUI's emulator would ({@link scanTerminalModes}).
 *
 * Semantics follow @xterm/headless 6 (`InputHandler` set/resetModePrivate,
 * requestMode, softReset, sendDeviceAttributesPrimary): the host must answer
 * exactly what the TUI's emulator answers once it attaches.
 */

export type MouseProtocol = "none" | "x10" | "vt200" | "drag" | "any"
export type MouseEncoding = "default" | "sgr" | "sgr-pixels"

export interface TerminalModes {
  applicationCursorKeys: boolean
  applicationKeypad: boolean
  origin: boolean
  wraparound: boolean
  reverseWraparound: boolean
  cursorBlink: boolean
  cursorVisible: boolean
  insertMode: boolean
  sendFocus: boolean
  bracketedPaste: boolean
  synchronizedOutput: boolean
  altScreen: boolean
  mouseProtocol: MouseProtocol
  mouseEncoding: MouseEncoding
}

/** Modes plus the unterminated escape a chunk boundary split. */
export interface TerminalModeTrack {
  modes: TerminalModes
  carry: string
}

const DEFAULT_MODES: Readonly<TerminalModes> = {
  applicationCursorKeys: false,
  applicationKeypad: false,
  origin: false,
  wraparound: true,
  reverseWraparound: false,
  cursorBlink: false,
  cursorVisible: true,
  insertMode: false,
  sendFocus: false,
  bracketedPaste: false,
  synchronizedOutput: false,
  altScreen: false,
  mouseProtocol: "none",
  mouseEncoding: "default",
}

const MOUSE_PROTOCOLS: Readonly<Record<number, MouseProtocol>> = { 9: "x10", 1000: "vt200", 1002: "drag", 1003: "any" }
const MOUSE_ENCODINGS: Readonly<Record<number, MouseEncoding>> = { 1006: "sgr", 1016: "sgr-pixels" }

/** A garbage-filled stream must not grow the carry without bound. */
const MAX_CARRY = 64

/** xterm.js's primary DA reply (`termName` "xterm"). */
const DA1_REPLY = "\x1b[?1;2c"

export function freshModeTrack(modes: TerminalModes = { ...DEFAULT_MODES }): TerminalModeTrack {
  return { modes, carry: "" }
}

/** A persisted mode record → full modes; anything missing or malformed reads as the default. */
export function normalizeTerminalModes(raw: unknown): TerminalModes {
  const modes = { ...DEFAULT_MODES }
  if (typeof raw !== "object" || raw === null) return modes
  const record = raw as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_MODES) as (keyof TerminalModes)[]) {
    if (typeof record[key] === "boolean" && typeof modes[key] === "boolean") (modes[key] as boolean) = record[key]
  }
  if (Object.values(MOUSE_PROTOCOLS).includes(record.mouseProtocol as MouseProtocol))
    modes.mouseProtocol = record.mouseProtocol as MouseProtocol
  if (Object.values(MOUSE_ENCODINGS).includes(record.mouseEncoding as MouseEncoding))
    modes.mouseEncoding = record.mouseEncoding as MouseEncoding
  return modes
}

/**
 * Fold one chunk of child output (latin1-decoded, so bytes map 1:1) into
 * `track`. Returns the replies an xterm.js emulator would send for the DA1 /
 * DECRQM queries in it, in stream order; each reflects the modes at the point
 * the query appeared.
 */
export function scanTerminalModes(track: TerminalModeTrack, chunk: string): string[] {
  const text = track.carry + chunk
  track.carry = ""
  const replies: string[] = []
  let i = text.indexOf("\x1b")
  while (i !== -1) {
    if (i + 1 >= text.length) {
      track.carry = "\x1b"
      break
    }
    const next = text.charCodeAt(i + 1)
    if (next === 0x5b /* [ */) {
      const end = csiEnd(text, i + 2)
      if (end === -1) {
        if (text.length - i <= MAX_CARRY) track.carry = text.slice(i)
        break
      }
      if (end >= 0) applyCsi(track.modes, text.slice(i + 2, end), text[end] as string, replies)
      i = text.indexOf("\x1b", end >= 0 ? end + 1 : i + 2)
      continue
    }
    if (next === 0x3d /* = */) track.modes.applicationKeypad = true
    else if (next === 0x3e /* > */) track.modes.applicationKeypad = false
    else if (next === 0x63 /* c, RIS */) track.modes = { ...DEFAULT_MODES }
    i = text.indexOf("\x1b", i + 1)
  }
  return replies
}

/**
 * Escapes that re-create `modes` on a default-state emulator, prepended to a
 * full ring replay. Synchronized output is left out: at a ring cut it is the
 * middle of one frame, and the ring itself carries that frame's end.
 */
export function terminalModePreamble(modes: TerminalModes): string {
  const set: number[] = []
  const reset: number[] = []
  if (modes.applicationCursorKeys) set.push(1)
  if (modes.origin) set.push(6)
  if (!modes.wraparound) reset.push(7)
  if (modes.cursorBlink) set.push(12)
  if (!modes.cursorVisible) reset.push(25)
  if (modes.reverseWraparound) set.push(45)
  for (const [mode, protocol] of Object.entries(MOUSE_PROTOCOLS)) if (modes.mouseProtocol === protocol) set.push(+mode)
  for (const [mode, encoding] of Object.entries(MOUSE_ENCODINGS)) if (modes.mouseEncoding === encoding) set.push(+mode)
  if (modes.sendFocus) set.push(1004)
  if (modes.bracketedPaste) set.push(2004)
  let out = modes.altScreen ? "\x1b[?1049h" : ""
  if (set.length > 0) out += `\x1b[?${set.join(";")}h`
  if (reset.length > 0) out += `\x1b[?${reset.join(";")}l`
  if (modes.applicationKeypad) out += "\x1b="
  if (modes.insertMode) out += "\x1b[4h"
  return out
}

/** Index of the CSI final byte; -1 when the text ends first, -2 when a
 *  non-CSI byte aborts it. */
function csiEnd(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    const c = text.charCodeAt(j)
    if (c >= 0x40 && c <= 0x7e) return j
    if (c < 0x20 || c > 0x3f) return -2
  }
  return -1
}

function applyCsi(modes: TerminalModes, body: string, final: string, replies: string[]): void {
  let start = 0
  let prefix = ""
  const first = body.charCodeAt(0)
  if (first >= 0x3c && first <= 0x3f) {
    prefix = body[0] as string
    start = 1
  }
  let end = body.length
  while (end > start && body.charCodeAt(end - 1) <= 0x2f) end--
  const intermediates = body.slice(end)
  const params = body
    .slice(start, end)
    .split(";")
    .map((param) => Number.parseInt(param.split(":")[0] ?? "", 10) || 0)
  if (intermediates === "" && (final === "h" || final === "l")) {
    const on = final === "h"
    if (prefix === "?") for (const mode of params) setPrivateMode(modes, mode, on)
    else if (prefix === "" && params.includes(4)) modes.insertMode = on
  } else if (intermediates === "$" && final === "p" && (prefix === "?" || prefix === "")) {
    const mode = params[0] ?? 0
    const value = prefix === "?" ? privateModeValue(modes, mode) : ansiModeValue(modes, mode)
    replies.push(`\x1b[${prefix}${mode};${value}$y`)
  } else if (intermediates === "!" && final === "p" && prefix === "") {
    softReset(modes)
  } else if (intermediates === "" && final === "c" && prefix === "" && (params[0] ?? 0) === 0) {
    replies.push(DA1_REPLY)
  }
}

function setPrivateMode(modes: TerminalModes, mode: number, on: boolean): void {
  if (mode in MOUSE_PROTOCOLS) {
    modes.mouseProtocol = on ? (MOUSE_PROTOCOLS[mode] as MouseProtocol) : "none"
    return
  }
  if (mode in MOUSE_ENCODINGS) {
    modes.mouseEncoding = on ? (MOUSE_ENCODINGS[mode] as MouseEncoding) : "default"
    return
  }
  switch (mode) {
    case 1:
      modes.applicationCursorKeys = on
      break
    case 6:
      modes.origin = on
      break
    case 7:
      modes.wraparound = on
      break
    case 12:
      modes.cursorBlink = on
      break
    case 25:
      modes.cursorVisible = on
      break
    case 45:
      modes.reverseWraparound = on
      break
    case 66:
      modes.applicationKeypad = on
      break
    case 1004:
      modes.sendFocus = on
      break
    case 47:
    case 1047:
    case 1049:
      modes.altScreen = on
      break
    case 2004:
      modes.bracketedPaste = on
      break
    case 2026:
      modes.synchronizedOutput = on
      break
  }
}

/** DECSTR: xterm.js resets its core modes and shows the cursor; mouse and the active buffer stay. */
function softReset(modes: TerminalModes): void {
  Object.assign(modes, {
    applicationCursorKeys: false,
    applicationKeypad: false,
    origin: false,
    wraparound: true,
    reverseWraparound: false,
    cursorVisible: true,
    insertMode: false,
    sendFocus: false,
    bracketedPaste: false,
    synchronizedOutput: false,
  } satisfies Partial<TerminalModes>)
}

// DECRPM values.
const NOT_RECOGNIZED = 0
const SET = 1
const RESET = 2
const PERMANENTLY_SET = 3
const PERMANENTLY_RESET = 4

const flag = (on: boolean): number => (on ? SET : RESET)

function privateModeValue(modes: TerminalModes, mode: number): number {
  if (mode in MOUSE_PROTOCOLS) return flag(modes.mouseProtocol === MOUSE_PROTOCOLS[mode])
  if (mode in MOUSE_ENCODINGS) return flag(modes.mouseEncoding === MOUSE_ENCODINGS[mode])
  switch (mode) {
    case 1:
      return flag(modes.applicationCursorKeys)
    case 6:
      return flag(modes.origin)
    case 7:
      return flag(modes.wraparound)
    case 8:
      return PERMANENTLY_SET
    case 12:
      return flag(modes.cursorBlink)
    case 25:
      return flag(modes.cursorVisible)
    case 45:
      return flag(modes.reverseWraparound)
    case 66:
      return flag(modes.applicationKeypad)
    case 67:
    case 1005:
    case 1015:
      return PERMANENTLY_RESET
    case 1004:
      return flag(modes.sendFocus)
    case 1048:
      return SET
    case 47:
    case 1047:
    case 1049:
      return flag(modes.altScreen)
    case 2004:
      return flag(modes.bracketedPaste)
    case 2026:
      return flag(modes.synchronizedOutput)
    default:
      return NOT_RECOGNIZED
  }
}

function ansiModeValue(modes: TerminalModes, mode: number): number {
  switch (mode) {
    case 2:
      return PERMANENTLY_RESET
    case 4:
      return flag(modes.insertMode)
    case 12:
      return PERMANENTLY_SET
    case 20:
      return RESET
    default:
      return NOT_RECOGNIZED
  }
}

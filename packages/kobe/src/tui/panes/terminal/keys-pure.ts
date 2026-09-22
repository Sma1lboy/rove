/**
 * Pure helpers for the terminal pane's key handling. Must stay free of
 * opentui runtime imports: unit tests run under Node, and `@opentui/core`'s
 * native bindings need Bun.
 */

import type { KeyEvent } from "@opentui/core"

import { defaultChordsOf } from "../../context/keybindings.ts"
import { isKittyModifierKeyEvent } from "../../lib/modifier-keys.ts"

/**
 * Kitty CSI-u sequence (ctrl+c = `\x1b[99;5u`, esc = `\x1b[27u`). The host
 * enables kitty (`useKittyKeyboard`), so on capable terminals modifier chords
 * and esc arrive CSI-u encoded.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the raw ESC-prefixed kitty wire encoding is the whole point
const KITTY_CSI_U_RE = /^\x1b\[[\d:;]*u$/

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined || codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  }
  return false
}

/** Classic C0 mappings for ctrl+punctuation (ctrl+\ = SIGQUIT etc.). */
const CTRL_PUNCT_C0: Record<string, string> = {
  "@": "\x00",
  "[": "\x1b",
  "\\": "\x1c",
  "]": "\x1d",
  "^": "\x1e",
  _: "\x1f",
  "?": "\x7f",
}

type LegacyFunctionKey =
  | { readonly kind: "ss3"; readonly final: string }
  | { readonly kind: "tilde"; readonly number: number }

const LEGACY_FUNCTION_KEYS: Readonly<Record<string, LegacyFunctionKey>> = {
  f1: { kind: "ss3", final: "P" },
  f2: { kind: "ss3", final: "Q" },
  f3: { kind: "ss3", final: "R" },
  f4: { kind: "ss3", final: "S" },
  f5: { kind: "tilde", number: 15 },
  f6: { kind: "tilde", number: 17 },
  f7: { kind: "tilde", number: 18 },
  f8: { kind: "tilde", number: 19 },
  f9: { kind: "tilde", number: 20 },
  f10: { kind: "tilde", number: 21 },
  f11: { kind: "tilde", number: 23 },
  f12: { kind: "tilde", number: 24 },
}

const XTERM_MODIFIER_NAMED_KEYS = new Set([
  "delete",
  "kpdelete",
  "insert",
  "kpinsert",
  "up",
  "kpup",
  "down",
  "kpdown",
  "right",
  "kpright",
  "left",
  "kpleft",
  "home",
  "kphome",
  "end",
  "kpend",
  "pageup",
  "kppageup",
  "pagedown",
  "kppagedown",
])

function legacyModifier(evt: KeyEvent): number {
  return (
    1 +
    (evt.shift ? 1 : 0) +
    (evt.option || evt.meta ? 2 : 0) +
    (evt.ctrl ? 4 : 0) +
    (evt.super ? 8 : 0) +
    (evt.hyper ? 16 : 0)
  )
}

function legacyCursorSequence(evt: KeyEvent, final: string, applicationCursorKeys: boolean): string {
  const modifier = legacyModifier(evt)
  if (modifier !== 1) return `\x1b[1;${modifier}${final}`
  return applicationCursorKeys ? `\x1bO${final}` : `\x1b[${final}`
}

function legacyTildeSequence(evt: KeyEvent, number: number): string {
  const modifier = legacyModifier(evt)
  return modifier === 1 ? `\x1b[${number}~` : `\x1b[${number};${modifier}~`
}

function legacyFunctionSequence(evt: KeyEvent, key: LegacyFunctionKey): string {
  if (key.kind === "tilde") return legacyTildeSequence(evt, key.number)
  const modifier = legacyModifier(evt)
  return modifier === 1 ? `\x1bO${key.final}` : `\x1b[1;${modifier}${key.final}`
}

export interface TerminalInputModes {
  readonly applicationCursorKeys: boolean
  readonly applicationKeypad: boolean
}

export const NORMAL_TERMINAL_INPUT_MODES: TerminalInputModes = {
  applicationCursorKeys: false,
  applicationKeypad: false,
}

/**
 * Encode an opentui `KeyEvent` to the bytes the shell expects.
 *
 * Legacy keystrokes forward `evt.sequence` verbatim. Kitty CSI-u ones must be
 * re-encoded (the PTY never negotiated kitty) and their `sequence` is
 * unusable, measured on the wire: ctrl+c ⇒ `{ raw: "\x1b[99;5u", sequence:
 * "c" }` (would type "c"); esc ⇒ `{ raw: "\x1b[27u", sequence: "\x1b[27u" }`
 * (garbage). So if EITHER field is CSI-u shaped we synthesize from
 * name+modifiers; synthetic events (tests) lack `sequence` and synthesize too.
 */
export function keyEventToShellBytes(
  evt: KeyEvent,
  modes: TerminalInputModes = NORMAL_TERMINAL_INPUT_MODES,
): string | null {
  if (isKittyModifierKeyEvent(evt)) return null
  const e = evt as KeyEvent & { sequence?: string; raw?: string }
  const seq = typeof e.sequence === "string" && e.sequence.length > 0 ? e.sequence : null
  const kittyInput =
    e.source === "kitty" ||
    (typeof e.raw === "string" && KITTY_CSI_U_RE.test(e.raw)) ||
    (seq != null && KITTY_CSI_U_RE.test(seq))
  if (seq != null && !kittyInput) return seq
  // Kitty wire with typed TEXT in `sequence` (shift+z → "Z"): with no
  // ctrl/alt/meta/super that text IS the byte; synthesis would drop the shift
  // (measured: Shift+Z typed "z"). ctrl and super (Cmd) lie ("c" for ctrl+c /
  // Cmd+C) and control chars ("\t" for shift+tab) must synthesize instead.
  if (seq != null && !containsControlCharacter(seq) && !evt.ctrl && !e.option && !e.meta && !evt.super) return seq
  return synthesizeShellBytes(evt, modes)
}

function synthesizeShellBytes(evt: KeyEvent, modes: TerminalInputModes): string | null {
  const name = evt.name
  if (!name) return null

  // shift+tab is the back-tab CSI claude's plan-mode cycle expects;
  // alt+<key> is ESC-prefixed per xterm convention.
  if (evt.shift && name === "tab") return "\x1b[Z"
  const functionKey = LEGACY_FUNCTION_KEYS[name]
  const xtermModifiedNamedKey = functionKey !== undefined || XTERM_MODIFIER_NAMED_KEYS.has(name)
  if ((evt.option || evt.meta) && !xtermModifiedNamedKey) {
    const inner = synthesizeShellBytes({ ...evt, option: false, meta: false } as KeyEvent, modes)
    return inner == null ? null : `\x1b${inner}`
  }

  if (functionKey) return legacyFunctionSequence(evt, functionKey)

  switch (name) {
    case "return":
    case "enter":
      return "\r"
    case "kpenter":
      return modes.applicationKeypad && legacyModifier(evt) === 1 ? "\x1bOM" : "\r"
    case "tab":
      return "\t"
    case "backspace":
      return "\x7f"
    case "delete":
    case "kpdelete":
      return legacyTildeSequence(evt, 3)
    case "insert":
    case "kpinsert":
      return legacyTildeSequence(evt, 2)
    case "up":
    case "kpup":
      return legacyCursorSequence(evt, "A", modes.applicationCursorKeys)
    case "down":
    case "kpdown":
      return legacyCursorSequence(evt, "B", modes.applicationCursorKeys)
    case "right":
    case "kpright":
      return legacyCursorSequence(evt, "C", modes.applicationCursorKeys)
    case "left":
    case "kpleft":
      return legacyCursorSequence(evt, "D", modes.applicationCursorKeys)
    case "home":
    case "kphome":
      return legacyCursorSequence(evt, "H", modes.applicationCursorKeys)
    case "end":
    case "kpend":
      return legacyCursorSequence(evt, "F", modes.applicationCursorKeys)
    case "pageup":
    case "kppageup":
      return legacyTildeSequence(evt, 5)
    case "pagedown":
    case "kppagedown":
      return legacyTildeSequence(evt, 6)
    case "clear":
      return "\x1b[E"
    case "escape":
      return "\x1b"
    case "space":
      return evt.ctrl ? "\x00" : " "
    default:
      if (name.length === 1) {
        if (evt.ctrl) {
          const lower = name.toLowerCase()
          const code = lower.charCodeAt(0)
          if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code - 0x60)
          const c0 = CTRL_PUNCT_C0[name]
          if (c0 != null) return c0
          // Unknown ctrl chord: dropping beats typing a stray literal.
          return null
        }
        // Cmd/Win (kitty `super`): no terminal encodes cmd+<char> as a
        // byte; drop it rather than type the bare letter (Cmd+C → "c").
        if (evt.super) return null
        // Synthetic shifted letter: type the uppercase form.
        if (evt.shift && name >= "a" && name <= "z") return name.toUpperCase()
        return name
      }
      return null
  }
}

/**
 * Chords that copy the terminal selection to the clipboard.
 *
 * `cmd+c` is the macOS platform copy chord (the platform's own behavior, not
 * a new binding). `ctrl+shift+c` is the Linux/Windows emulator convention,
 * leaving ctrl+c as SIGINT; only kitty-protocol terminals can express it (a
 * legacy terminal sends the same C0 byte as ctrl+c), so `matchKey` mints it
 * there alone.
 *
 * PROPOSED, pending owner sign-off per AGENTS.md: `ctrl+shift+c` is a NEW
 * chord.
 */
export const COPY_CHORDS: readonly string[] = ["cmd+c", "ctrl+shift+c"]

/** Lines per `ctrl+pgup` / `ctrl+pgdown` when no `pageSize` accessor is supplied. */
export const DEFAULT_PAGE_SIZE = 10

/** Keys trapped (never forwarded to the shell). */
export const TRAPPED_KEYS = ["ctrl+pageup", "ctrl+pagedown"] as const

/**
 * Chords the terminal pane must NEVER pass through to the shell. Deliberately
 * MINIMAL: the engine CLI owns its chords (shift+tab, ctrl+r, ctrl+hjkl…), and
 * kobe's other globals stay reachable from non-terminal panes. The command
 * prefix is claimed dynamically by the dispatcher instead, so a live rebind
 * releases the old prefix immediately. Not here: bare `escape`/`tab` (vim,
 * shell completion) and `ctrl+pageup`/`ctrl+pagedown` (trapped earlier,
 * first-match-wins).
 *
 * Entries: `{ id }` reserves that keymap id's DEFAULT direct chords via
 * `defaultChordsOf` (pristine defaults, so a user override never changes what
 * the terminal swallows); a chord literal is reserved though no keymap row
 * binds it directly (prefix-only rows whose direct chords the terminal still
 * swallows, pending a decision on releasing them to the PTY).
 */
const RESERVED_SPEC: ReadonlyArray<string | { id: string }> = [
  // Docs promise "F1 anywhere" and the status bar advertises it inside the
  // terminal. No engine binds F1.
  { id: "help.open" }, // f1
  // THE escape hatch out of the terminal, back to the task list.
  { id: "focus.sidebar" }, // ctrl+q
  // Tab management (tmux root key-table parity). ctrl+w / f2 double as
  // `workspace.split.close` / `workspace.split.rename`; one reservation covers both.
  { id: "chat.tab.new" }, // ctrl+t
  { id: "chat.tab.close" }, // ctrl+w
  { id: "chat.tab.cycle-next" }, // ctrl+]
  { id: "chat.tab.cycle-prev" }, // ctrl+[
  { id: "chat.tab.rename" }, // f2
  // ctrl+e opens the new-conversation dialog. ctrl+f has no direct binding
  // but stays reserved: it's that dialog's context toggle, and releasing it
  // would make the byte mean different things per focus.
  "ctrl+e", // chat.tab.chooseEngine
  "ctrl+f", // new-chat dialog context toggle
  // Split panes (tmux % / "). Reserving ctrl+\ costs the shell SIGQUIT:
  // accepted, documented in docs/KEYBINDINGS.md.
  { id: "workspace.split.right" }, // ctrl+\
  { id: "workspace.split.down" }, // ctrl+=
  { id: "workspace.split.focus-next" }, // f3 — still a direct default
  // Pane cycle from inside the terminal; `tab` stays passthrough.
  { id: "focus.next" }, // f4
  // Terminal reset (confirm-gated).
  { id: "terminal.reset" }, // f5
  // f6 is not reserved (zen is prefix-only). Next waiting task is f7, NOT
  // ctrl+g (readline abort); see docs/KEYBINDINGS.md.
  { id: "attention.next" }, // f7
] as const

export const RESERVED_GLOBAL_CHORDS: readonly string[] = [
  ...new Set(RESERVED_SPEC.flatMap((entry) => (typeof entry === "string" ? [entry] : defaultChordsOf(entry.id)))),
]

/** opentui key names forwarded to the shell when the terminal pane is focused. */
export const PASSTHROUGH_NAMES: readonly string[] = [
  // Letters
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  // Digits
  ..."0123456789".split(""),
  // Punctuation
  ..." `~!@#$%^&*()-_=+[]{}\\|;:'\",.<>/?".split(""),
  // Named keys
  "return",
  "enter",
  "space",
  "tab",
  "backspace",
  "delete",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageup",
  "pagedown",
  "escape",
  "insert",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
]

/** Modifier prefixes the passthrough table expands each name with. */
const PASSTHROUGH_MODIFIER_PREFIXES = ["", "ctrl+", "alt+", "shift+", "ctrl+shift+", "alt+shift+", "ctrl+alt+"] as const

/**
 * Every `PASSTHROUGH_NAMES × modifier-prefix` chord minus the reserved ones.
 * Computed once at load: the pane re-renders per PTY frame, and rebuilding
 * ~850 strings per render was measurable GC pressure.
 */
export const PASSTHROUGH_CHORDS: readonly string[] = PASSTHROUGH_NAMES.flatMap((name) =>
  PASSTHROUGH_MODIFIER_PREFIXES.map((prefix) => `${prefix}${name}`),
).filter((chord) => !RESERVED_GLOBAL_CHORDS.includes(chord))

/**
 * Encode one wheel tick like a real emulator (routing contract:
 * `TaskPtyLike.wheel`). Null means the app asked for neither, so the caller
 * scrolls its local view.
 */
export function encodeWheel(
  modes: { mouseTracking: boolean; applicationCursorKeys: boolean; alternateScreen: boolean },
  direction: "up" | "down",
  col: number,
  row: number,
): string | null {
  if (modes.mouseTracking) {
    // SGR (1006) assumed: xterm.js doesn't expose the negotiated encoding,
    // and every current TUI (claude, vim, less --mouse) requests SGR.
    const btn = direction === "up" ? 64 : 65
    return `\x1b[<${btn};${Math.max(1, col)};${Math.max(1, row)}M`
  }
  if (modes.alternateScreen) {
    // Fullscreen app without mouse reporting: 3 arrow keys per tick.
    const arrow = modes.applicationCursorKeys
      ? direction === "up"
        ? "\x1bOA"
        : "\x1bOB"
      : direction === "up"
        ? "\x1b[A"
        : "\x1b[B"
    return arrow.repeat(3)
  }
  return null
}

/**
 * Encode one mouse button transition (SGR 1006). Null when the app didn't ask
 * for the mouse, so the caller keeps the click for its own selection.
 * Modifier bits: shift 4, alt 8, ctrl 16. `drag` (button-held motion) is
 * reported only under mode 1002/1003.
 */
export function encodeMouseButton(
  modes: { mouseTracking: "none" | "x10" | "vt200" | "drag" | "any" },
  kind: "down" | "up" | "drag",
  button: 0 | 1 | 2,
  col: number,
  row: number,
  modifiers?: { shift?: boolean; alt?: boolean; ctrl?: boolean },
): string | null {
  if (modes.mouseTracking === "none") return null
  if (kind === "drag" && modes.mouseTracking !== "drag" && modes.mouseTracking !== "any") return null
  let code: number = button
  if (kind === "drag") code += 32
  if (modifiers?.shift) code += 4
  if (modifiers?.alt) code += 8
  if (modifiers?.ctrl) code += 16
  return `\x1b[<${code};${Math.max(1, col)};${Math.max(1, row)}${kind === "up" ? "m" : "M"}`
}

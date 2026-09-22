/** Turns one OpenTUI key event into ordered chord candidates; `keymap-dispatch.ts` owns the stack. */

import type { KeyEvent } from "@opentui/core"

/**
 * Build normalized match keys for a `KeyEvent`. Mirrors the chord shape
 * opencode bindings use (`ctrl+c`, `shift+tab`, `k`).
 */
export function matchKey(evt: KeyEvent): string[] {
  // Bindings use both "return" and "enter"; either name must match.
  const base: string[] = []
  const name = evt.name
  if (name) base.push(name)
  if (name === "return") base.push("enter")
  if (name === "enter") base.push("return")

  // Without the kitty protocol (Terminal.app), ctrl+h / ctrl+j arrive as raw
  // 0x08 / 0x0a and parse as backspace / linefeed with ctrl=false. Alias them
  // back. The real Backspace key sends 0x7f, so it never aliases.
  if (name === "backspace" && evt.raw === "\b" && !evt.meta && !evt.option) base.push("ctrl+h")
  if (name === "linefeed" && !evt.meta && !evt.option) base.push("ctrl+j")

  // The only place chord prefixes are minted:
  //   ctrl → `ctrl+`.
  //   meta OR super → `cmd+`. A forwarded Command key arrives over kitty as
  //     `super` (bit 8), not `meta` — `parseKeypress("\x1b[99;9u")` gives
  //     `{ name: "c", super: true, meta: false }`. Kept apart from `alt+` so a
  //     leaked Cmd chord can't fire an Option binding.
  //   option → `alt+`. KNOWN BUG: opentui also sets `meta` for Alt (`ESC k` →
  //     `{ meta: true, option: false }`), so Option mints `cmd+k`/`cmd+alt+k`
  //     and every `alt+…` row in KobeKeymap is dead. The embedded terminal is
  //     unaffected: Option falls through to the encoder.
  //   shift + single char, no other modifier → `shift+z` first, then `z`, so
  //     `Z` can be bound apart while bare-letter bindings still catch it.
  //     Candidate order is the precedence contract.
  const mods: string[] = []
  if (evt.ctrl) mods.push("ctrl")
  if (evt.meta || evt.super) mods.push("cmd")
  if (evt.option) mods.push("alt")
  const bareShiftChar = evt.shift && name !== undefined && name.length === 1 && mods.length === 0
  if (evt.shift && name && name.length > 1) mods.push("shift")

  if (mods.length === 0) {
    if (bareShiftChar) return [...base.map((n) => `shift+${n}`), ...base]
    return base
  }
  const prefix = `${mods.join("+")}+`
  // Only prefixed forms: a bare `k` binding must not catch `ctrl+k`, or
  // pane-local j/k would shadow the global palette chord.
  const prefixed = base.map((n) => prefix + n)
  // ctrl+shift+c is only distinguishable from ctrl+c on the kitty wire; mint
  // it there, ahead of the unshifted form, which legacy terminals fall back to.
  if (evt.shift && name !== undefined && name.length === 1 && evt.source === "kitty") {
    return [...base.map((n) => `${mods.join("+")}+shift+${n}`), ...prefixed]
  }
  return prefixed
}

/**
 * Pure key-event normalization for the Binding Stack.
 *
 * Split out of `keymap-dispatch.ts` at its existing input-normalization
 * boundary. Dispatch owns stack state and command execution; this module
 * only turns one OpenTUI event into ordered chord candidates.
 */

import type { KeyEvent } from "@opentui/core"

/**
 * Build normalized match keys for a `KeyEvent`. Mirrors the chord shape
 * opencode bindings use (`ctrl+c`, `shift+tab`, `k`).
 */
export function matchKey(evt: KeyEvent): string[] {
  // opentui's KeyEvent has `name` (e.g. "k", "escape", "return") plus modifier
  // booleans. We build a few candidate strings so a binding registered as
  // either "return" or "enter" still fires; opencode dialogs use both names.
  const base: string[] = []
  const name = evt.name
  if (name) base.push(name)
  if (name === "return") base.push("enter")
  if (name === "enter") base.push("return")

  // Legacy C0 fallback. Terminals without the kitty keyboard
  // protocol (macOS Terminal.app) send ctrl+h as raw 0x08 and ctrl+j as raw
  // 0x0a, which opentui's legacy parser surfaces as {name:"backspace"} /
  // {name:"linefeed"} with ctrl=false — so `ctrl+h`/`ctrl+j` chords (pane
  // focus) would be dead there while ctrl+k/ctrl+l (0x0b/0x0c) work. Alias the
  // two ambiguous bytes back to their chord names. The real Backspace key
  // sends 0x7f, so it never aliases; a terminal configured to "Backspace
  // sends ^H" trades deletion for pane focus, same as kitty-mode terminals.
  if (name === "backspace" && evt.raw === "\b" && !evt.meta && !evt.option) base.push("ctrl+h")
  if (name === "linefeed" && !evt.meta && !evt.option) base.push("ctrl+j")

  // Modifier mapping rules (the *only* place chord prefixes are minted):
  //   - `evt.ctrl`   → `ctrl+`. Universal across terminals.
  //   - `evt.meta` OR `evt.super` → `cmd+`. Most terminals do NOT forward the
  //                    Command key — Cmd+C is normally eaten by the emulator
  //                    for native copy. Kitty / Ghostty / iTerm2 *can* be
  //                    configured to forward it, and when they do it arrives
  //                    over the kitty protocol as `super` (modifier bit 8),
  //                    NOT `meta` (bit 32) — measured against
  //                    `parseKeypress("\x1b[99;9u", { useKittyKeyboard: true })`,
  //                    which yields `{ name: "c", super: true, meta: false }`.
  //                    Reading only `meta` here left `super` invisible to every
  //                    layer, so Cmd+C degraded to the bare chord `c`, matched
  //                    the terminal passthrough, and TYPED A LITERAL "c" into
  //                    the session. We keep `cmd+` as a prefix distinct from
  //                    `alt+` so a Cmd+X chord that leaks into the app doesn't
  //                    accidentally fire an Option+X binding.
  //   - `evt.option` → `alt+`. Option on macOS / Alt elsewhere.
  //                    KNOWN BUG, pre-dating the `super` fix above and left
  //                    alone deliberately: opentui also sets `meta` for Alt on
  //                    both wire formats — measured, `ESC k` yields
  //                    `{ meta: true, option: false }` and kitty mask 2 yields
  //                    `{ meta: true, option: true }` — so an Option chord
  //                    mints `cmd+k` / `cmd+alt+k`, never the plain `alt+k`
  //                    this once claimed. Every `alt+…` row in KobeKeymap is
  //                    therefore dead. The embedded terminal is unaffected:
  //                    no `cmd+alt+` chord is in the passthrough table, so
  //                    Option falls through to the encoder and still sends
  //                    the correct `ESC`-prefixed bytes.
  //   - shift+letter arrives as `{name:"z", shift:true}` (both the legacy
  //     and kitty parser paths). With NO other modifier we mint `shift+z`
  //     FIRST and plain `z` as a FALLBACK candidate, so `Z` can be bound
  //     apart from `z` while every existing bare-letter binding (and the
  //     evt.shift-discriminating handlers) keeps catching uppercase.
  //     Candidate ORDER is the precedence contract — dispatch tries
  //     `shift+z` against a whole bindings entry before falling back.
  //     With ctrl/cmd/alt also held, shift on a single char is minted ONLY
  //     for kitty-sourced events, as a higher-precedence candidate ahead of
  //     the unshifted form (`ctrl+shift+c` then `ctrl+c`). Legacy terminals
  //     send ctrl+shift+z and ctrl+z as the same C0 byte and report no shift,
  //     so they keep matching the unshifted chord and nothing regresses.
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
  // When modifiers are present, return ONLY the prefixed forms. A plain
  // `{ key: "k" }` binding must NOT catch `ctrl+k` — otherwise pane-local
  // bindings (sidebar j/k) shadow global chords (`ctrl+k` palette).
  // Bindings that want both behaviors must register both keys explicitly.
  const prefixed = base.map((n) => prefix + n)
  // Modified shift on a single char is only DISTINGUISHABLE on the kitty
  // wire, so it is minted there alone — ahead of the unshifted candidate, so
  // a `ctrl+shift+c` binding wins where the terminal can express it while
  // every legacy terminal still falls back to `ctrl+c`.
  if (evt.shift && name !== undefined && name.length === 1 && evt.source === "kitty") {
    return [...base.map((n) => `${mods.join("+")}+shift+${n}`), ...prefixed]
  }
  return prefixed
}

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
  //   - `evt.meta`   → `cmd+`. The Command key on macOS / Win key on Windows.
  //                    Most terminals do NOT forward this — Cmd+C is normally
  //                    eaten by the terminal emulator itself for native copy.
  //                    Kitty / Ghostty / iTerm2 *can* be configured to forward
  //                    it; when they do, kobe sees `meta=true`. We keep `cmd+`
  //                    as a separate prefix from `alt+` so a Cmd+X chord that
  //                    leaks into the app doesn't accidentally fire an
  //                    Option+X binding (the previous code aliased both to
  //                    `alt+`, which made `cmd+p`/`cmd+k` bindings in
  //                    KobeKeymap silently dead — KOB key-routing fix).
  //   - `evt.option` → `alt+`. Option on macOS / Alt elsewhere. macOS Option+K
  //                    arrives as `ESC k` which opentui surfaces as
  //                    `option=true`, name=`k` → `alt+k`.
  //   - shift+letter arrives as `{name:"z", shift:true}` (both the legacy
  //     and kitty parser paths). With NO other modifier we mint `shift+z`
  //     FIRST and plain `z` as a FALLBACK candidate, so `Z` can be bound
  //     apart from `z` while every existing bare-letter binding (and the
  //     evt.shift-discriminating handlers) keeps catching uppercase.
  //     Candidate ORDER is the precedence contract — dispatch tries
  //     `shift+z` against a whole bindings entry before falling back.
  //     With ctrl/cmd/alt also held, shift on a single char stays DROPPED:
  //     legacy terminals send ctrl+shift+z and ctrl+z as the same C0 byte,
  //     so such chords would only fire on kitty-protocol terminals.
  const mods: string[] = []
  if (evt.ctrl) mods.push("ctrl")
  if (evt.meta) mods.push("cmd")
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
  return base.map((n) => prefix + n)
}

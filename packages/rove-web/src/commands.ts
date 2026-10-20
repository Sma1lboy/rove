/**
 * What the web can actually run, by the TUI's own binding ids (`RoveKeymap`).
 * Modules register the commands they bind; the palette (prefix `/`), F1 help,
 * the prefix guide and the footer hints all read this list, so none of them can
 * name a chord the page does not handle. Pane keys that live in another view
 * (rail, files) are run by replaying their key on that pane.
 */

import { type RoveBinding, RoveKeymap } from "@sma1lboy/rove/src/tui/context/keybindings-table.ts"
import type { AppModel } from "./model.ts"
import { userChordsOf } from "./user-keys.ts"

export type Surface = "sidebar" | "workspace" | "files" | "terminal"

export interface WebCommand {
  readonly id: string
  /** Chords as `RoveKeymap` spells them (`ctrl+e`, `n`); for a prefix command, the second strokes. */
  readonly chords: readonly string[]
  readonly prefix: boolean
  /** Where it applies; omitted = everywhere. A `workspace` command also applies inside the terminal, as in the TUI. */
  readonly surface?: Surface
  /** The pane's own key handler already runs it; the registry only lists it. */
  readonly native?: boolean
  readonly live?: (model: AppModel) => boolean
  readonly run: (model: AppModel, chord?: string) => void
}

/** The TUI's `BindingReachability`: ids a keypress can run right now. */
export interface Reachability {
  readonly direct: ReadonlySet<string>
  readonly prefix: ReadonlySet<string>
  /** The focused surface forwards unclaimed keys to a PTY. */
  readonly inputPassthrough: boolean
}

const sources: Array<() => readonly WebCommand[]> = []

/** Lazy, so a module can register before the commands' own dependencies have loaded. */
export function registerCommands(source: () => readonly WebCommand[]): void {
  sources.push(source)
}

/** Where a binding's `scope` applies. */
const SCOPE_SURFACE: Readonly<Record<string, Surface>> = {
  workspace: "workspace",
  sidebar: "sidebar",
  files: "files",
  terminal: "terminal",
}

/**
 * The registered commands with the user's `keybindings.yaml` applied: an id the file rebinds runs on
 * the file's chords (empty = unbound). A direct chord given to an id the web only registers as a
 * prefix stroke becomes its own command, as the TUI registers every row's `keys`.
 */
export function allCommands(): WebCommand[] {
  const base = sources.flatMap((source) => source())
  const direct = new Set(base.filter((command) => !command.prefix).map((command) => command.id))
  const out = base.map((command) => {
    const chords = userChordsOf(command.id, command.prefix ? "prefix" : "direct")
    return chords ? { ...command, chords } : command
  })
  for (const command of base) {
    const chords = command.prefix ? userChordsOf(command.id, "direct") : undefined
    if (!chords || chords.length === 0 || direct.has(command.id)) continue
    direct.add(command.id)
    const scope = RoveKeymap.find((row) => row.id === command.id)?.scope ?? "global"
    out.push({ ...command, prefix: false, chords, ...(SCOPE_SURFACE[scope] ? { surface: SCOPE_SURFACE[scope] } : {}) })
  }
  return out
}

export function appliesOn(command: WebCommand, surface: Surface | null): boolean {
  if (!command.surface) return true
  return command.surface === surface || (surface === "terminal" && command.surface === "workspace")
}

/** Most local first, as the TUI walks its binding stack top-down: the focused pane's own, then the workspace's, then global. */
export function specificity(command: WebCommand, surface: Surface | null): number {
  return command.surface === surface ? 0 : command.surface ? 1 : 2
}

/** The pane that has focus: xterm's textarea is the terminal, the rail and Files are their elements. */
export function currentSurface(): Surface | null {
  const el = document.activeElement
  if (!(el instanceof Element)) return null
  if (el.closest(".xterm")) return "terminal"
  if (el.closest(".rail")) return "sidebar"
  if (el.closest(".files")) return "files"
  if (el.closest(".workspace")) return "workspace"
  return null
}

export function reachability(model: AppModel, surface: Surface | null): Reachability {
  const direct = new Set<string>()
  const prefix = new Set<string>()
  for (const command of allCommands()) {
    if (!appliesOn(command, surface) || command.live?.(model) === false) continue
    ;(command.prefix ? prefix : direct).add(command.id)
  }
  return { direct, prefix, inputPassthrough: surface === "terminal" }
}

/** The keymap rows the web binds somewhere, in the TUI's order: F1 and the palette must not teach more than that. */
export function boundKeymap(): readonly RoveBinding[] {
  const ids = new Set(allCommands().map((command) => command.id))
  return RoveKeymap.filter((binding) => ids.has(binding.id))
}

/** A `RoveKeymap` chord as the `KeyboardEvent` that presses it. */
export function keyInit(chord: string): KeyboardEventInit {
  const parts = chord.split("+")
  const name = parts.at(-1) ?? chord
  const mods = parts.slice(0, -1)
  const named: Record<string, string> = {
    return: "Enter",
    space: " ",
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    escape: "Escape",
    pageup: "PageUp",
    pagedown: "PageDown",
  }
  const shift = mods.includes("shift")
  const key = named[name] ?? (shift && name.length === 1 ? name.toUpperCase() : name)
  return {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: mods.includes("ctrl"),
    metaKey: mods.includes("cmd"),
    altKey: mods.includes("alt"),
    shiftKey: shift,
  }
}

/** A pane command that has no function of its own: replay its key on the pane, so the key and the palette share one code path. */
export function paneCommand(
  id: string,
  surface: "sidebar" | "files",
  chords: readonly string[],
  target: string,
  live?: (model: AppModel) => boolean,
): WebCommand {
  return {
    id,
    chords,
    prefix: false,
    surface,
    native: true,
    live,
    run: () => {
      const pane = document.querySelector<HTMLElement>(target)
      const chord = chords[0]
      if (!pane || !chord) return
      pane.focus()
      pane.dispatchEvent(new KeyboardEvent("keydown", keyInit(chord)))
    },
  }
}

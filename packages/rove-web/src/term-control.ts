/**
 * What the rest of the page can ask a terminal to do: scroll a page, search, reset.
 * Each mounted xterm registers a control under its stream (`<task>::<tab>[::leaf-N]`);
 * the one holding focus is `focusedTerm`. The terminal-scope commands (TUI
 * `terminal.*`) live here so the palette, F1 and the keys all run the same functions.
 */

import { registerCommands } from "./commands.ts"
import { createStore } from "./store.ts"

export interface TermControl {
  readonly stream: string
  focus(): void
  /** `ctrl+pgup` / `ctrl+pgdown`: a page of scrollback (the TUI's ten lines). */
  scrollPages(direction: 1 | -1): void
  hasSelection(): boolean
  /** Copy the selection and drop it; false = there was none. */
  copySelection(): boolean
  openSearch(): void
  /** F5: confirm, then kill the shell and spawn a fresh one. */
  reset(): void
  size(): { cols: number; rows: number }
}

const registry = new Map<string, TermControl>()
export const focusedTerm = createStore<TermControl | null>(null)

export function registerTerm(control: TermControl): () => void {
  registry.set(control.stream, control)
  return () => {
    if (registry.get(control.stream) === control) registry.delete(control.stream)
    if (focusedTerm.get() === control) focusedTerm.set(null)
  }
}

export function termFor(stream: string): TermControl | undefined {
  return registry.get(stream)
}

registerCommands(() => [
  {
    id: "terminal.scroll-up",
    chords: ["ctrl+pageup"],
    prefix: false,
    surface: "terminal",
    run: () => focusedTerm.get()?.scrollPages(-1),
  },
  {
    id: "terminal.scroll-down",
    chords: ["ctrl+pagedown"],
    prefix: false,
    surface: "terminal",
    run: () => focusedTerm.get()?.scrollPages(1),
  },
  {
    id: "terminal.reset",
    chords: ["f5"],
    prefix: false,
    surface: "terminal",
    run: () => focusedTerm.get()?.reset(),
  },
  {
    id: "terminal.search",
    chords: ["/"],
    prefix: true,
    surface: "terminal",
    live: () => focusedTerm.get() !== null,
    run: () => focusedTerm.get()?.openSearch(),
  },
])

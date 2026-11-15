/**
 * Settings page navigation keys: j/k (and arrows, tab) move, h/l switch
 * between the section list and its rows, enter activates, and the Engines /
 * Keybindings sections add their row verbs.
 */

import type { NavLevel } from "../../../tui/component/settings-dialog/model"
import type { VendorId } from "../../../types/task"
import { useBindings } from "../../lib/keymap"
import type { useEngineSettings } from "./use-engine-settings"
import type { KeybindingEditor } from "./use-keybinding-editor"

export function useSettingsNavKeys(opts: {
  /** Off while a sub-dialog, the feedback form or the search owns the keyboard. */
  enabled: boolean
  level: () => NavLevel
  setLevel: (level: NavLevel) => void
  move: (delta: number) => void
  enterBody: () => void
  activate: () => void
  /** The engine / binding under the body cursor, or null elsewhere. */
  engineRow: () => VendorId | null
  keyRow: () => string | null
  engines: ReturnType<typeof useEngineSettings>
  keyEditor: KeybindingEditor
}): void {
  useBindings(() => ({
    // Suspend our navigation keys while a sub-dialog (the engine-command /
    // custom-editor text input) is open so `l`/`j`/`k`/`h` reach the input
    // instead of being eaten here.
    enabled: opts.enabled,
    bindings: [
      { key: "down", cmd: () => opts.move(1) },
      { key: "up", cmd: () => opts.move(-1) },
      { key: "j", cmd: () => opts.move(1) },
      { key: "k", cmd: () => opts.move(-1) },
      { key: "tab", cmd: () => opts.move(1) },
      { key: "right", cmd: opts.enterBody },
      { key: "l", cmd: opts.enterBody },
      { key: "left", cmd: () => opts.setLevel("sidebar") },
      { key: "h", cmd: () => opts.setLevel("sidebar") },
      {
        key: "return",
        cmd: () => {
          if (opts.level() === "sidebar") {
            opts.enterBody()
            return
          }
          opts.activate()
        },
      },
      {
        // Engines section only: `r` renames the focused engine's display
        // label, `x` resets a built-in (or removes a custom) engine.
        key: "r",
        cmd: () => {
          const v = opts.engineRow()
          if (v) void opts.engines.renameEngine(v)
        },
      },
      {
        key: "x",
        cmd: () => {
          const v = opts.engineRow()
          if (v) opts.engines.resetEngine(v)
          const id = opts.keyRow()
          if (id) opts.keyEditor.unbind(id)
        },
      },
      {
        // Keybindings section: `x` above unbinds the focused binding, `backspace` restores its default.
        key: "backspace",
        cmd: () => {
          const id = opts.keyRow()
          if (id) opts.keyEditor.reset(id)
        },
      },
      {
        // Engines section: `d` sets the focused engine as the global default.
        key: "d",
        cmd: () => {
          const v = opts.engineRow()
          if (v) opts.engines.chooseDefaultEngine(v)
        },
      },
      {
        // Engines section: `space` switches the focused engine on or off.
        // PROPOSED chord — surfaced for sign-off, see docs/KEYBINDINGS.md.
        key: "space",
        cmd: () => {
          const v = opts.engineRow()
          if (v) opts.engines.toggleEngineEnabled(v)
        },
      },
    ],
  }))
}

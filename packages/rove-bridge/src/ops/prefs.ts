/**
 * `prefs.get` / `prefs.set`: the Settings knobs the TUI keeps in state.json (appearance, General,
 * notifications, Dev flags), read through the TUI's normalizers and written to the same keys, so
 * every surface (TUI, web, phones) shows one setting. The allowlist and per-key validation live
 * in `prefs-defs.ts`; nothing here accepts a free-form string that the Mac later runs or stores.
 * `theme.taskColors` is the read half for the per-task colour setting.
 *
 * A running TUI picks every key up live from the daemon's `state` push.
 */

import { type StateSnapshot, loadStateFile, patchStateFile } from "@sma1lboy/rove/src/state/store.ts"
import type { ThemeJson } from "@sma1lboy/rove/src/tui/context/theme-core.ts"
import { BUNDLED_THEME_JSONS } from "@sma1lboy/rove/src/tui/context/theme/bundled.ts"
import { loadUserThemes } from "@sma1lboy/rove/src/tui/context/theme/loader.ts"
import { GLYPH_SETS } from "@sma1lboy/rove/src/tui/lib/glyphs.ts"
import { BridgeError } from "../protocol.ts"
import { PREF_DEFS, type PrefDef, checkPrefValue, prefInfo } from "./prefs-defs.ts"
import { palette, taskColors } from "./theme-palette.ts"
import type { OpTable } from "./types.ts"

export interface PrefsDeps {
  readonly load: () => StateSnapshot
  readonly patch: (patch: StateSnapshot) => void
  /** Bundled themes, then the user's (`<state dir>/themes/*.json`, which win on a name clash). */
  readonly themes: () => readonly { name: string; bundled: boolean; theme: ThemeJson }[]
}

const realDeps: PrefsDeps = {
  load: loadStateFile,
  patch: (patch) => {
    patchStateFile(patch)
  },
  themes: () => {
    const user = loadUserThemes()
    const names = new Set(user.map((u) => u.name))
    return [
      ...Object.entries(BUNDLED_THEME_JSONS)
        .filter(([name]) => !names.has(name))
        .map(([name, theme]) => ({ name, bundled: true, theme })),
      ...user.map((u) => ({ name: u.name, bundled: false, theme: u.theme })),
    ]
  },
}

const MAX_TASK_IDS = 500
const MODES = ["dark", "light"] as const

function readAll(deps: PrefsDeps, state: StateSnapshot) {
  const themes = deps.themes()
  const names = themes.map((t) => t.name)
  const prefs: Record<string, unknown> = {}
  const options: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(PREF_DEFS)) {
    prefs[name] = def.read(state)
    if (def.kind === "enum") options[name] = def.choices(names)
    else if (def.kind === "int") options[name] = { min: def.min, max: def.max }
  }
  return { prefs, options, info: prefInfo(state), themes }
}

export function createPrefsOps(deps: PrefsDeps): OpTable {
  return {
    "prefs.get": {
      kind: "read",
      destructive: false,
      wraps: "state.json Settings keys read through the TUI normalizers, plus resolved theme palettes and glyph sets",
      async run() {
        const { prefs, options, info, themes } = readAll(deps, deps.load())
        return {
          prefs,
          options,
          info,
          glyphSets: GLYPH_SETS,
          themes: themes.map((t) => ({
            name: t.name,
            bundled: t.bundled,
            dark: palette(t.theme, "dark"),
            light: palette(t.theme, "light"),
          })),
        }
      },
    },
    "prefs.set": {
      kind: "write",
      destructive: false,
      wraps: "state.json: one allowlisted Settings key per call, value checked against the TUI's own choices",
      async run(args) {
        const name = args.key
        if (typeof name !== "string" || !Object.hasOwn(PREF_DEFS, name)) {
          throw new BridgeError("BAD_ARGS", `key must be one of ${Object.keys(PREF_DEFS).join("|")}`)
        }
        const def = PREF_DEFS[name] as PrefDef
        const state = deps.load()
        const names = deps.themes().map((t) => t.name)
        const value = checkPrefValue(name, def, args.value, names)
        deps.patch(def.write(value as never, state))
        // Read back through the normalizer: what the TUI will now see, not what was sent.
        const { prefs } = readAll(deps, deps.load())
        return { key: name, value: prefs[name], prefs }
      },
    },
    "theme.taskColors": {
      kind: "read",
      destructive: false,
      wraps: "the TUI's taskColor(taskId, theme) for each id under one theme and mode",
      async run(args) {
        const { themes } = readAll(deps, deps.load())
        const theme = themes.find((t) => t.name === args.theme)
        if (!theme) throw new BridgeError("BAD_ARGS", "theme is not an installed theme")
        const mode = MODES.find((m) => m === args.mode)
        if (!mode) throw new BridgeError("BAD_ARGS", "mode must be dark|light")
        const ids = args.taskIds
        if (
          !Array.isArray(ids) ||
          ids.length > MAX_TASK_IDS ||
          !ids.every((id) => typeof id === "string" && id.length <= 64)
        ) {
          throw new BridgeError("BAD_ARGS", `taskIds must be at most ${MAX_TASK_IDS} task ids`)
        }
        return { colors: taskColors(theme.theme, mode, ids as string[]) }
      },
    },
  }
}

export const prefsOps: OpTable = createPrefsOps(realDeps)

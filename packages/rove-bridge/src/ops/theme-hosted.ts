/**
 * `theme.hosted` / `theme.install`: the themes served from rove.run (not bundled), resolved to
 * palettes so a page can preview one before it is installed, and installed by name into
 * `<state dir>/themes/` through the same parse and write as `rove theme add`. Only the hosted names
 * are accepted: a page never makes the Mac fetch or write a URL of its choosing. `theme.hosted` also
 * names that directory, which the page hands to an agent asked to write a theme.
 */

import type { ThemeJson } from "@sma1lboy/rove/src/tui/context/theme-core.ts"
import {
  HOSTED_THEMES,
  ThemeInstallError,
  hostedThemeUrl,
  parseTheme,
  writeUserTheme,
} from "@sma1lboy/rove/src/tui/context/theme/install.ts"
import { loadUserThemes, userThemesDir } from "@sma1lboy/rove/src/tui/context/theme/loader.ts"
import { BridgeError } from "../protocol.ts"
import { palette } from "./theme-palette.ts"
import type { OpTable } from "./types.ts"

export interface HostedThemeDeps {
  readonly fetchText: (url: string) => Promise<string>
  /** Names in `<state dir>/themes/`. */
  readonly installed: () => readonly string[]
  readonly write: (name: string, theme: ThemeJson) => void
}

const FETCH_TIMEOUT_MS = 8000

const realDeps: HostedThemeDeps = {
  async fetchText(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  },
  installed: () => loadUserThemes().map((t) => t.name),
  write: (name, theme) => {
    writeUserTheme(name, theme, false)
  },
}

export function createHostedThemeOps(deps: HostedThemeDeps): OpTable {
  // A theme's file does not change between releases of the site; one fetch per bridge is enough.
  const cache = new Map<string, ThemeJson>()
  const load = async (name: string): Promise<ThemeJson> => {
    const known = cache.get(name)
    if (known) return known
    const theme = parseTheme(await deps.fetchText(hostedThemeUrl(name)))
    cache.set(name, theme)
    return theme
  }

  return {
    "theme.hosted": {
      kind: "read",
      destructive: false,
      wraps:
        "the rove.run theme catalogue, each theme resolved to #rrggbb for dark and light, whether it is installed, and the user themes directory",
      async run() {
        const installed = new Set(deps.installed())
        const settled = await Promise.allSettled(HOSTED_THEMES.map(load))
        const themes = []
        const unavailable: string[] = []
        for (const [i, name] of HOSTED_THEMES.entries()) {
          const got = settled[i]
          if (got?.status !== "fulfilled") {
            unavailable.push(name)
            continue
          }
          themes.push({
            name,
            installed: installed.has(name),
            dark: palette(got.value, "dark"),
            light: palette(got.value, "light"),
          })
        }
        return { themes, unavailable, dir: userThemesDir() }
      },
    },
    "theme.install": {
      kind: "write",
      destructive: false,
      wraps: "rove theme add https://rove.run/themes/<name>.json, for a catalogue name only; never overwrites",
      async run(args) {
        const name = HOSTED_THEMES.find((n) => n === args.name)
        if (!name) throw new BridgeError("BAD_ARGS", `name must be one of ${HOSTED_THEMES.join("|")}`)
        if (deps.installed().includes(name)) return { name, installed: false }
        let theme: ThemeJson
        try {
          theme = await load(name)
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          throw new BridgeError("UNAVAILABLE", `could not fetch ${hostedThemeUrl(name)}: ${reason}`)
        }
        try {
          deps.write(name, theme)
        } catch (err) {
          if (err instanceof ThemeInstallError) throw new BridgeError("CONFLICT", err.message)
          throw err
        }
        return { name, installed: true }
      },
    },
  }
}

export const hostedThemeOps: OpTable = createHostedThemeOps(realDeps)

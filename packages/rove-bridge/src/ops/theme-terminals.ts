/**
 * `theme.terminals` / `theme.importTerminal`: auto-detected local terminal emulator configs
 * (Ghostty, Kitty, Alacritty, WezTerm), resolved to palettes so the web gallery can preview
 * them before importing, and installed by terminal id into `<state dir>/themes/`. Only the
 * allowlisted terminal ids are accepted: the browser never passes a filesystem path.
 */

import { ThemeInstallError, writeUserTheme } from "@sma1lboy/rove-core/theme/install.ts"
import { loadUserThemes } from "@sma1lboy/rove-core/theme/loader.ts"
import {
  type DetectedTerminalTheme,
  TERMINAL_IDS,
  type TerminalId,
  detectLocalTerminalThemes,
  detectTerminalTheme,
  isTerminalId,
} from "@sma1lboy/rove-core/theme/terminal-detect.ts"
import type { ThemeJson } from "@sma1lboy/rove-core/theme/theme-data.ts"
import { BridgeError } from "../protocol.ts"
import { palette } from "./theme-palette.ts"
import type { OpTable } from "./types.ts"

export interface TerminalThemeDeps {
  readonly detectAll: () => readonly DetectedTerminalTheme[]
  readonly detectOne: (id: TerminalId) => DetectedTerminalTheme | null
  readonly installed: () => readonly string[]
  readonly write: (name: string, theme: ThemeJson) => void
}

const realDeps: TerminalThemeDeps = {
  detectAll: () => detectLocalTerminalThemes(),
  detectOne: (id) => detectTerminalTheme(id),
  installed: () => loadUserThemes().map((t) => t.name),
  write: (name, theme) => {
    writeUserTheme(name, theme, true)
  },
}

export function createTerminalThemeOps(deps: TerminalThemeDeps): OpTable {
  return {
    "theme.terminals": {
      kind: "read",
      destructive: false,
      wraps: "local terminal emulator configs (Ghostty, Kitty, Alacritty, WezTerm) resolved to preview palettes",
      async run() {
        const installed = new Set(deps.installed())
        const terminals = deps.detectAll().map((t) => ({
          id: t.id,
          label: t.label,
          name: t.themeName,
          configPath: t.configPath,
          ...(t.sourceTheme ? { sourceTheme: t.sourceTheme } : {}),
          ...(t.scheme.fontFamily ? { fontFamily: t.scheme.fontFamily } : {}),
          installed: installed.has(t.themeName),
          dark: palette(t.theme, "dark"),
          light: palette(t.theme, "light"),
        }))
        return { terminals }
      },
    },
    "theme.importTerminal": {
      kind: "write",
      destructive: false,
      wraps: "rove theme import <terminal>, for an allowlisted terminal id only; overwrites to sync changes",
      async run(args) {
        const raw = typeof args.terminal === "string" ? args.terminal : undefined
        if (!isTerminalId(raw)) {
          throw new BridgeError("BAD_ARGS", `terminal must be one of ${TERMINAL_IDS.join("|")}`)
        }
        const detected = deps.detectOne(raw)
        if (!detected) {
          throw new BridgeError("NOT_FOUND", `no readable color theme found for ${raw}`)
        }
        try {
          deps.write(detected.themeName, detected.theme)
        } catch (err) {
          if (err instanceof ThemeInstallError) throw new BridgeError("BAD_ARGS", err.message)
          throw err
        }
        return {
          name: detected.themeName,
          terminal: detected.id,
          installed: true,
          ...(detected.scheme.fontFamily ? { fontFamily: detected.scheme.fontFamily } : {}),
        }
      },
    },
  }
}

export const terminalThemeOps: OpTable = createTerminalThemeOps(realDeps)

/**
 * `rove api theme-import`: detect local terminal emulator configs (Ghostty, Kitty, Alacritty,
 * WezTerm) and import one into `<roveStateDir()>/themes/` as a Rove theme, switching `activeTheme`
 * by default so attached TUIs and web clients pick it up immediately.
 */

import { ThemeInstallError } from "@sma1lboy/rove-core/theme/install.ts"
import {
  TERMINAL_IDS,
  type TerminalId,
  detectLocalTerminalThemes,
  detectTerminalTheme,
  installDetectedTerminalTheme,
} from "@sma1lboy/rove-core/theme/terminal-detect.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

async function handleThemeImport(ctx: VerbContext): Promise<unknown> {
  if (ctx.args.bool("list")) {
    const detected = detectLocalTerminalThemes()
    return {
      terminals: detected.map((d) => ({
        id: d.id,
        label: d.label,
        configPath: d.configPath,
        themeName: d.themeName,
        ...(d.sourceTheme ? { sourceTheme: d.sourceTheme } : {}),
        ...(d.scheme.fontFamily ? { fontFamily: d.scheme.fontFamily } : {}),
        background: d.scheme.background,
        foreground: d.scheme.foreground,
        ...(d.scheme.cursor ? { cursor: d.scheme.cursor } : {}),
        ansiCount: d.scheme.ansi.filter(Boolean).length,
      })),
    }
  }

  const terminal = ctx.args.str("terminal") as TerminalId | undefined
  const detected = terminal ? detectTerminalTheme(terminal) : (detectLocalTerminalThemes()[0] ?? null)
  if (!detected) {
    throw new ApiError(
      terminal
        ? `no readable color theme found for ${terminal}`
        : `no readable local terminal theme found (checked ${TERMINAL_IDS.join(", ")})`,
      "TERMINAL_NOT_FOUND",
      {
        hint: "run `rove api theme-import --list` to see which local terminal configs were detected",
        nextCommandArgs: ["api", "theme-import", "--list"],
      },
    )
  }

  try {
    const result = installDetectedTerminalTheme(detected, {
      name: ctx.args.str("name"),
      force: ctx.args.bool("force"),
      activate: !ctx.args.bool("no-switch"),
    })
    return {
      terminal: result.terminal,
      label: result.label,
      name: result.name,
      path: result.path,
      configPath: result.configPath,
      switched: result.activated,
      ...(result.sourceTheme ? { sourceTheme: result.sourceTheme } : {}),
      ...(result.fontFamily ? { fontFamily: result.fontFamily } : {}),
    }
  } catch (err) {
    if (err instanceof ThemeInstallError) {
      const code = err.message.includes("already exists") ? "THEME_EXISTS" : "BAD_THEME"
      throw new ApiError(err.message, code)
    }
    throw err
  }
}

export const THEME_IMPORT_VERB: VerbSpec = {
  name: "theme-import",
  group: "edit",
  summary:
    "Auto-detect local terminal emulator configs (Ghostty, Kitty, Alacritty, WezTerm) and import one as a Rove theme (background, foreground, cursor, ANSI 16 colors, optional fontFamily). Switches Rove to the imported theme unless --no-switch is passed. Pass --list to inspect detected terminals without writing.",
  flags: [
    {
      name: "list",
      type: "bool",
      description: "List detected local terminal configs and their extracted colors/font without installing.",
    },
    {
      name: "terminal",
      type: "enum",
      values: TERMINAL_IDS,
      placeholder: TERMINAL_IDS.join("|"),
      description: "Terminal emulator to import from. Omit to pick the first detected terminal.",
    },
    {
      name: "name",
      type: "string",
      placeholder: "NAME",
      description: "Theme name under ~/.rove/themes/<name>.json (defaults to the terminal id).",
    },
    {
      name: "force",
      type: "bool",
      description: "Overwrite an existing user theme with the same name.",
    },
    {
      name: "no-switch",
      type: "bool",
      description: "Install the theme without switching activeTheme in state.json.",
    },
  ],
  offline: true,
  handler: handleThemeImport,
}

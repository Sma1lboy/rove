/**
 * Zero-dependency parsers and auto-detection for Ghostty, Kitty, Alacritty, and WezTerm configs.
 * Uses an in-memory filesystem map through `DetectTerminalEnv` so tests are fast, deterministic,
 * and never read the operator's real home directory.
 */

import { resolveThemeSlotHex } from "@sma1lboy/rove-core/theme/hex.ts"
import { validateTheme } from "@sma1lboy/rove-core/theme/schema.ts"
import {
  type DetectTerminalEnv,
  detectLocalTerminalThemes,
  detectTerminalTheme,
} from "@sma1lboy/rove-core/theme/terminal-detect.ts"
import {
  parseAlacrittyToml,
  parseGhosttyConfig,
  parseKittyConfig,
  parseWeztermLua,
} from "@sma1lboy/rove-core/theme/terminal-parsers.ts"
import { parseTerminalScheme, themeFromTerminalScheme } from "@sma1lboy/rove-core/theme/terminal-scheme.ts"
import { describe, expect, test } from "vitest"

function fakeEnv(
  files: Record<string, string>,
  opts: { homeDir?: string; platform?: NodeJS.Platform; env?: Record<string, string | undefined> } = {},
): DetectTerminalEnv {
  const homeDir = opts.homeDir ?? "/home/tester"
  return {
    homeDir,
    platform: opts.platform ?? "darwin",
    env: opts.env ?? {},
    readText: (path) => (Object.hasOwn(files, path) ? (files[path] as string) : null),
    readDir: (dir) => {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`
      const entries = new Set<string>()
      for (const path of Object.keys(files)) {
        if (!path.startsWith(prefix)) continue
        const rest = path.slice(prefix.length)
        const slash = rest.indexOf("/")
        entries.add(slash >= 0 ? rest.slice(0, slash) : rest)
      }
      return [...entries]
    },
  }
}

describe("Ghostty parser and detector", () => {
  test("parses inline colors, cursor-color, 16 ANSI palette entries, and font-family", () => {
    const text = [
      "# Ghostty config",
      "background = #1e1e2e",
      "foreground = #cdd6f4",
      "cursor-color = #f5e0dc",
      'font-family = "Berkeley Mono"',
      "font-family = Symbols Nerd Font",
      "font-family-bold = Berkeley Mono Bold",
      "palette = 0=#45475a",
      "palette = 1=#f38ba8",
      "palette = 2=#a6e3a1",
      "palette = 4=#89b4fa",
      "palette = 15=#a6adc8",
    ].join("\n")

    const parsed = parseGhosttyConfig(text)
    expect(parsed.scheme.background).toBe("#1e1e2e")
    expect(parsed.scheme.foreground).toBe("#cdd6f4")
    expect(parsed.scheme.cursor).toBe("#f5e0dc")
    // First non-empty font-family wins; bold variant does not overwrite it.
    expect(parsed.scheme.fontFamily).toBe("Berkeley Mono")
    expect(parsed.scheme.ansi[0]).toBe("#45475a")
    expect(parsed.scheme.ansi[1]).toBe("#f38ba8")
    expect(parsed.scheme.ansi[15]).toBe("#a6adc8")
  })

  test("detects Ghostty across XDG + macOS Application Support, resolves theme = dark:..., and ignores empty config.ghostty", () => {
    const env = fakeEnv({
      "/home/tester/.config/ghostty/config": [
        "theme = dark:Catppuccin Mocha,light:Catppuccin Latte",
        "font-family = JetBrains Mono",
        "config-file = ?extra.conf",
      ].join("\n"),
      "/home/tester/.config/ghostty/extra.conf": "cursor-color = #f5e0dc\n",
      "/home/tester/.config/ghostty/themes/Catppuccin Mocha": [
        "background = #1e1e2e",
        "foreground = #cdd6f4",
        "palette = 1=#f38ba8",
        "palette = 2=#a6e3a1",
        "palette = 4=#89b4fa",
      ].join("\n"),
      "/home/tester/Library/Application Support/com.mitchellh.ghostty/config.ghostty": "",
    })

    const detected = detectTerminalTheme("ghostty", env)
    expect(detected).not.toBeNull()
    expect(detected?.configPath).toBe("/home/tester/.config/ghostty/config")
    expect(detected?.sourceTheme).toBe("Catppuccin Mocha")
    expect(detected?.scheme.background).toBe("#1e1e2e")
    expect(detected?.scheme.cursor).toBe("#f5e0dc")
    expect(detected?.scheme.fontFamily).toBe("JetBrains Mono")
    expect(detected?.theme.fontFamily).toBe("JetBrains Mono")
    expect(resolveThemeSlotHex(detected!.theme, "cursor")).toBe("#f5e0dc")
    expect(resolveThemeSlotHex(detected!.theme, "terminalRed")).toBe("#f38ba8")
    expect(validateTheme(detected!.theme).ok).toBe(true)
  })
})

describe("Kitty parser and detector", () => {
  test("parses Kitty colors, cursor, color0..color15, and family= font syntax", () => {
    const text = [
      'font_family family="Fira Code" postscript_name=FiraCode-Regular',
      "background #0f111a",
      "foreground #a6accd",
      "cursor #ffcc00",
      "color0 #090b10",
      "color1 #f07178",
      "color2 #c3e88d",
      "color4 #82aaff",
      "color15 #ffffff",
    ].join("\n")

    const parsed = parseKittyConfig(text)
    expect(parsed.scheme.background).toBe("#0f111a")
    expect(parsed.scheme.foreground).toBe("#a6accd")
    expect(parsed.scheme.cursor).toBe("#ffcc00")
    expect(parsed.scheme.fontFamily).toBe("Fira Code")
    expect(parsed.scheme.ansi[1]).toBe("#f07178")
    expect(parsed.scheme.ansi[15]).toBe("#ffffff")
  })

  test("merges current-theme.conf with kitty.conf font_family and handles include cycles safely", () => {
    const env = fakeEnv({
      "/home/tester/.config/kitty/kitty.conf": "font_family Iosevka\ninclude loop.conf\n",
      "/home/tester/.config/kitty/loop.conf": "include kitty.conf\n",
      "/home/tester/.config/kitty/current-theme.conf":
        "background #1a1b26\nforeground #c0caf5\ncursor #c0caf5\ncolor4 #7aa2f7\n",
    })

    const detected = detectTerminalTheme("kitty", env)
    expect(detected).not.toBeNull()
    expect(detected?.configPath).toBe("/home/tester/.config/kitty/kitty.conf")
    expect(detected?.scheme.background).toBe("#1a1b26")
    expect(detected?.scheme.fontFamily).toBe("Iosevka")
    expect(detected?.scheme.ansi[4]).toBe("#7aa2f7")
  })
})

describe("Alacritty TOML parser and detector", () => {
  test("parses [colors.*], 0x hex values, [[colors.indexed_colors]], [font.normal], and ignores CellForeground", () => {
    const toml = `
[font.normal]
family = "CommitMono" # inline comment

[colors.primary]
background = "0x1d1f21"
foreground = "#c5c8c6"

[colors.cursor]
cursor = "CellForeground"

[colors.normal]
black = "#1d1f21"
red = "#cc6666"
green = "#b5bd68"
yellow = "#f0c674"
blue = "#81a2be"
magenta = "#b294bb"
cyan = "#8abeb7"
white = "#c5c8c6"

[colors.bright]
black = "#666666"
red = "#d54e53"
white = "#eaeaea"

[[colors.indexed_colors]]
index = 12
color = "#7aa6da"
`
    const parsed = parseAlacrittyToml(toml)
    expect(parsed.scheme.background).toBe("#1d1f21")
    expect(parsed.scheme.foreground).toBe("#c5c8c6")
    expect(parsed.scheme.cursor).toBeUndefined()
    expect(parsed.scheme.fontFamily).toBe("CommitMono")
    expect(parsed.scheme.ansi[1]).toBe("#cc6666")
    expect(parsed.scheme.ansi[4]).toBe("#81a2be")
    expect(parsed.scheme.ansi[8]).toBe("#666666")
    expect(parsed.scheme.ansi[12]).toBe("#7aa6da")
    expect(parsed.scheme.ansi[15]).toBe("#eaeaea")

    // Also works through parseTerminalScheme (used by `rove theme add`).
    const scheme = parseTerminalScheme(toml)
    expect(scheme?.background).toBe("#1d1f21")
    expect(scheme?.fontFamily).toBe("CommitMono")
  })

  test("follows [general] multiline import array with main config overriding imported theme", () => {
    const env = fakeEnv({
      "/home/tester/.config/alacritty/alacritty.toml": [
        "[general]",
        "import = [",
        '  "~/.config/alacritty/themes/base.toml",',
        "]",
        "[colors.cursor]",
        'cursor = "#ff9e64"',
        "[font]",
        'normal = { family = "Maple Mono" }',
      ].join("\n"),
      "/home/tester/.config/alacritty/themes/base.toml": [
        "[colors.primary]",
        'background = "#24283b"',
        'foreground = "#c0caf5"',
        "[colors.normal]",
        'blue = "#7aa2f7"',
      ].join("\n"),
    })

    const detected = detectTerminalTheme("alacritty", env)
    expect(detected).not.toBeNull()
    expect(detected?.scheme.background).toBe("#24283b")
    expect(detected?.scheme.cursor).toBe("#ff9e64")
    expect(detected?.scheme.fontFamily).toBe("Maple Mono")
    expect(detected?.scheme.ansi[4]).toBe("#7aa2f7")
  })
})

describe("WezTerm Lua parser and detector", () => {
  test("parses inline colors table, comments, ansi/brights arrays, and font_with_fallback without executing Lua", () => {
    const lua = `
local wezterm = require 'wezterm'
local config = wezterm.config_builder()
-- config.colors = { background = "#000000" }
--[[
  config.font = wezterm.font("Ignored Font")
]]
config.font = wezterm.font_with_fallback({
  { family = "Geist Mono", weight = "Medium" },
  "Apple Color Emoji",
})
config.colors = {
  foreground = '#d8dee9',
  background = '#2e3440',
  cursor_bg = '#88c0d0',
  ansi = { '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0' },
  brights = { '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4' },
}
return config
`
    const parsed = parseWeztermLua(lua)
    expect(parsed.scheme.background).toBe("#2e3440")
    expect(parsed.scheme.foreground).toBe("#d8dee9")
    expect(parsed.scheme.cursor).toBe("#88c0d0")
    expect(parsed.scheme.fontFamily).toBe("Geist Mono")
    expect(parsed.scheme.ansi[0]).toBe("#3b4252")
    expect(parsed.scheme.ansi[1]).toBe("#bf616a")
    expect(parsed.scheme.ansi[8]).toBe("#4c566a")
    expect(parsed.scheme.ansi[15]).toBe("#eceff4")

    const scheme = parseTerminalScheme(lua)
    expect(scheme?.cursor).toBe("#88c0d0")
    const theme = themeFromTerminalScheme(scheme!)
    expect(theme.fontFamily).toBe("Geist Mono")
    expect(resolveThemeSlotHex(theme, "cursor")).toBe("#88c0d0")
    expect(resolveThemeSlotHex(theme, "terminalBrightWhite")).toBe("#eceff4")
  })

  test("resolves WezTerm color_scheme from colors/<name>.toml and applies Lua font()", () => {
    const env = fakeEnv({
      "/home/tester/.wezterm.lua": [
        "local wezterm = require('wezterm')",
        "return {",
        "  color_scheme = 'Rose Pine',",
        "  font = wezterm.font('MonoLisa'),",
        "}",
      ].join("\n"),
      "/home/tester/.config/wezterm/colors/rose-pine.toml": [
        "[colors]",
        'background = "#191724"',
        'foreground = "#e0def4"',
        'cursor_bg = "#ebbcba"',
        'ansi = ["#26233a", "#eb6f92", "#31748f", "#f6c177", "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4"]',
      ].join("\n"),
    })

    const detected = detectTerminalTheme("wezterm", env)
    expect(detected).not.toBeNull()
    expect(detected?.sourceTheme).toBe("Rose Pine")
    expect(detected?.scheme.background).toBe("#191724")
    expect(detected?.scheme.cursor).toBe("#ebbcba")
    expect(detected?.scheme.fontFamily).toBe("MonoLisa")
    expect(detected?.scheme.ansi[1]).toBe("#eb6f92")
  })
})

describe("detectLocalTerminalThemes", () => {
  test("returns every terminal with a readable scheme and skips incomplete configs", () => {
    const env = fakeEnv({
      "/home/tester/.config/ghostty/config": "background = #111111\nforeground = #eeeeee\n",
      "/home/tester/.config/kitty/kitty.conf": "font_family Menlo\n",
      "/home/tester/.config/alacritty/alacritty.toml":
        '[colors.primary]\nbackground = "#222222"\nforeground = "#dddddd"\n',
    })
    const detected = detectLocalTerminalThemes(env)
    expect(detected.map((d) => d.id)).toEqual(["ghostty", "alacritty"])
  })
})

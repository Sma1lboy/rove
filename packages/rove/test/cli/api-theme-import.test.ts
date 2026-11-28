/**
 * `rove api theme-import`: offline verb that probes local terminal configs and installs/switches
 * one into `<roveStateDir()>/themes/` + `state.json`. Uses a throwaway `ROVE_HOME_DIR` and
 * `XDG_CONFIG_HOME` so real user state and configs are never touched.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { invokeVerb } from "@sma1lboy/rove-api/cli/api-cmd.ts"
import { kvStatePath } from "@sma1lboy/rove-core/env.ts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let root: string
let origRoveHome: string | undefined
let origXdg: string | undefined

beforeEach(() => {
  origRoveHome = process.env.ROVE_HOME_DIR
  origXdg = process.env.XDG_CONFIG_HOME
  root = mkdtempSync(join(tmpdir(), "rove-api-theme-import-"))
  process.env.ROVE_HOME_DIR = join(root, "rove-home")
  process.env.XDG_CONFIG_HOME = join(root, "xdg")
})

afterEach(() => {
  if (origRoveHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = origRoveHome
  if (origXdg === undefined) Reflect.deleteProperty(process.env, "XDG_CONFIG_HOME")
  else process.env.XDG_CONFIG_HOME = origXdg
  rmSync(root, { recursive: true, force: true })
})

function writeAlacrittyFixture(): string {
  const dir = join(root, "xdg", "alacritty")
  mkdirSync(dir, { recursive: true })
  const file = join(dir, "alacritty.toml")
  writeFileSync(
    file,
    [
      "[font.normal]",
      'family = "Berkeley Mono"',
      "[colors.primary]",
      'background = "#181825"',
      'foreground = "#cdd6f4"',
      "[colors.cursor]",
      'cursor = "#f5e0dc"',
      "[colors.normal]",
      'red = "#f38ba8"',
      'green = "#a6e3a1"',
      'blue = "#89b4fa"',
    ].join("\n"),
    "utf8",
  )
  return file
}

describe("rove api theme-import", () => {
  it("--list reports detected terminals without writing a theme or state.json", async () => {
    const configPath = writeAlacrittyFixture()
    const reply = (await invokeVerb("theme-import", ["--list"], { client: null })) as {
      terminals: Array<{ id: string; configPath: string; fontFamily?: string; cursor?: string; ansiCount: number }>
    }
    const alacritty = reply.terminals.find((t) => t.id === "alacritty")
    expect(alacritty).toMatchObject({
      id: "alacritty",
      configPath,
      fontFamily: "Berkeley Mono",
      cursor: "#f5e0dc",
      ansiCount: 3,
    })
  })

  it("imports a named terminal, writes its JSON with fontFamily, switches activeTheme, and guards overwrite", async () => {
    writeAlacrittyFixture()
    const installed = (await invokeVerb("theme-import", ["--terminal", "alacritty", "--name", "my-alacritty"], {
      client: null,
    })) as { terminal: string; name: string; path: string; switched: boolean; fontFamily?: string }

    expect(installed).toMatchObject({
      terminal: "alacritty",
      name: "my-alacritty",
      switched: true,
      fontFamily: "Berkeley Mono",
    })
    const themeJson = JSON.parse(readFileSync(installed.path, "utf8")) as { fontFamily?: string }
    expect(themeJson.fontFamily).toBe("Berkeley Mono")
    const state = JSON.parse(readFileSync(kvStatePath(), "utf8")) as { activeTheme?: string }
    expect(state.activeTheme).toBe("my-alacritty")

    // Second call without --force fails with THEME_EXISTS.
    await expect(
      invokeVerb("theme-import", ["--terminal", "alacritty", "--name", "my-alacritty"], { client: null }),
    ).rejects.toMatchObject({ code: "THEME_EXISTS" })

    // With --force --no-switch, overwrites without changing activeTheme.
    const second = (await invokeVerb(
      "theme-import",
      ["--terminal", "alacritty", "--name", "other-alacritty", "--no-switch"],
      { client: null },
    )) as { switched: boolean }
    expect(second.switched).toBe(false)
    const stateAfter = JSON.parse(readFileSync(kvStatePath(), "utf8")) as { activeTheme?: string }
    expect(stateAfter.activeTheme).toBe("my-alacritty")
  })

  it("fails with TERMINAL_NOT_FOUND when the requested terminal has no config", async () => {
    await expect(invokeVerb("theme-import", ["--terminal", "kitty"], { client: null })).rejects.toMatchObject({
      code: "TERMINAL_NOT_FOUND",
    })
  })
})

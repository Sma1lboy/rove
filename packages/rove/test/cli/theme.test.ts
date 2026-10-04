/**
 * `kobe theme <list|add|remove>` (`runThemeSubcommand`). Real filesystem
 * under a per-test KOBE_HOME_DIR tempdir — `userThemesDir()` resolves off
 * that env var (roveStateDir() honours it), so list/add/remove exercise
 * real reads/writes. `fetch` is stubbed for the URL-source branch.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runThemeSubcommand } from "../../src/cli/theme.ts"
import { BUNDLED_THEME_JSONS } from "../../src/tui/context/theme/bundled.ts"

const VALID_THEME = {
  defs: { bg: "#000000", fg: "#ffffff" },
  theme: {
    background: "bg",
    foreground: "fg",
  },
}

let home: string
let originalHome: string | undefined
let outSpy: MockInstance<typeof process.stdout.write>
let errSpy: MockInstance<typeof process.stderr.write>
let exitSpy: MockInstance<typeof process.exit>

function themesDir(): string {
  return join(home, ".rove", "themes")
}

beforeEach(() => {
  originalHome = process.env.KOBE_HOME_DIR
  home = mkdtempSync(join(tmpdir(), "kobe-theme-"))
  process.env.KOBE_HOME_DIR = home

  outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`)
  }) as never)
})

afterEach(() => {
  if (originalHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = originalHome
  rmSync(home, { recursive: true, force: true })
  outSpy.mockRestore()
  errSpy.mockRestore()
  exitSpy.mockRestore()
  vi.unstubAllGlobals()
})

function out(): string {
  return outSpy.mock.calls.map((c) => String(c[0])).join("")
}
function err(): string {
  return errSpy.mock.calls.map((c) => String(c[0])).join("")
}

describe("runThemeSubcommand list", () => {
  it("lists a user theme, flagging one that overrides a bundled name", async () => {
    const dir = themesDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "my-theme.json"), "{}", "utf8")
    writeFileSync(join(dir, "claude.json"), "{}", "utf8")
    await runThemeSubcommand(["list"])
    const text = out()
    expect(text).toContain("my-theme")
    expect(text).toContain("claude (overrides built-in)")
  })

  // `theme list` must name every bundled theme, not a copy of the list that
  // happened to be true when it was written. Hand-mirroring the names leaves
  // two files and a "keep in sync" comment as the only thing holding them
  // together. This asserts against the map that owns the JSON imports, so
  // adding a bundled
  // theme without the CLI picking it up fails here.
  it("lists every bundled theme in the canonical map", async () => {
    await runThemeSubcommand(["list"])
    const text = out()
    for (const name of Object.keys(BUNDLED_THEME_JSONS)) {
      expect(text).toContain(name)
    }
  })
})

describe("runThemeSubcommand add (local path)", () => {
  it("installs a valid theme from a local file, defaulting the name to the basename", async () => {
    const src = join(home, "mytheme.json")
    writeFileSync(src, JSON.stringify(VALID_THEME), "utf8")
    await runThemeSubcommand(["add", src])
    const dest = join(themesDir(), "mytheme.json")
    expect(JSON.parse(readFileSync(dest, "utf8"))).toEqual(VALID_THEME)
    expect(out()).toContain(`installed theme "mytheme" -> ${dest}`)
  })

  it("--name overrides the default name", async () => {
    const src = join(home, "src.json")
    writeFileSync(src, JSON.stringify(VALID_THEME), "utf8")
    await runThemeSubcommand(["add", src, "--name", "custom"])
    expect(readFileSync(join(themesDir(), "custom.json"), "utf8")).toContain('"bg"')
  })

  it("refuses to overwrite an existing theme without --force", async () => {
    const src = join(home, "src.json")
    writeFileSync(src, JSON.stringify(VALID_THEME), "utf8")
    await runThemeSubcommand(["add", src, "--name", "dup"])
    await expect(runThemeSubcommand(["add", src, "--name", "dup"])).rejects.toThrow("exit 1")
    expect(err()).toContain("already exists (pass --force to overwrite)")
  })

  it("--force overwrites an existing theme", async () => {
    const src = join(home, "src.json")
    writeFileSync(src, JSON.stringify(VALID_THEME), "utf8")
    await runThemeSubcommand(["add", src, "--name", "dup"])
    await runThemeSubcommand(["add", src, "--name", "dup", "--force"])
    expect(out()).toContain('installed theme "dup"')
  })

  it("fails with exit 1 on a schema-invalid theme", async () => {
    const src = join(home, "invalid.json")
    writeFileSync(src, JSON.stringify({ nope: true }), "utf8")
    await expect(runThemeSubcommand(["add", src])).rejects.toThrow("exit 1")
    expect(err()).toContain("not a valid Rove theme")
  })

  it("rejects an invalid theme name", async () => {
    const src = join(home, "src.json")
    writeFileSync(src, JSON.stringify(VALID_THEME), "utf8")
    await expect(runThemeSubcommand(["add", src, "--name", "bad name!"])).rejects.toThrow("exit 1")
    expect(err()).toContain("invalid theme name")
  })
})

describe("runThemeSubcommand add (URL source)", () => {
  it("fetches, validates, and installs from an http(s) URL, naming from the URL basename", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(VALID_THEME)),
    })
    vi.stubGlobal("fetch", fetchMock)
    await runThemeSubcommand(["add", "https://example.com/themes/cool.json?token=abc"])
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/themes/cool.json?token=abc")
    expect(readFileSync(join(themesDir(), "cool.json"), "utf8")).toContain('"bg"')
  })

  it("fails with exit 1 on a non-OK HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }))
    await expect(runThemeSubcommand(["add", "https://example.com/x.json"])).rejects.toThrow("exit 1")
    expect(err()).toContain("HTTP 404 Not Found")
  })
})

describe("runThemeSubcommand remove", () => {
  it("removes a user theme", async () => {
    mkdirSync(themesDir(), { recursive: true })
    writeFileSync(join(themesDir(), "gone.json"), "{}", "utf8")
    await runThemeSubcommand(["remove", "gone"])
    expect(out()).toContain('removed theme "gone"')
    expect(() => readFileSync(join(themesDir(), "gone.json"), "utf8")).toThrow()
  })

  it("refuses to remove a bundled theme name", async () => {
    await expect(runThemeSubcommand(["remove", "claude"])).rejects.toThrow("exit 1")
    expect(err()).toContain("is a built-in theme and cannot be removed")
  })

  /**
   * `join()` resolves `..`, so a theme name is a relative path unless
   * something says otherwise. `add` validated its name from the start; `remove`
   * went straight from the argument to `unlinkSync`, so
   * `rove theme remove '../../precious/notes'` printed `removed theme` and
   * deleted a file two directories outside the themes dir. The `BUNDLED_NAMES`
   * check it did have only answers a different question.
   */
  it("refuses a name that escapes the themes directory", async () => {
    mkdirSync(join(home, "precious"), { recursive: true })
    const outside = join(home, "precious", "notes.json")
    writeFileSync(outside, '{"secret":"keep me"}', "utf8")

    await expect(runThemeSubcommand(["remove", "../../precious/notes"])).rejects.toThrow("exit 1")
    expect(err()).toContain('invalid theme name "../../precious/notes"')
    expect(readFileSync(outside, "utf8")).toBe('{"secret":"keep me"}')
  })
})

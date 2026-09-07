/**
 * readPersistedUiPrefs — the pane subprocess's read-only view of the outer
 * TUI's state.json. Pinned: theme names are validated against the registry
 * (a stale name falls back), the transparent/focus-accent/locale fields
 * validate independently, and a missing/corrupt file yields full defaults
 * instead of throwing (a pane must always render).
 *
 * `transparentBackground` has no fixed default any more — an ABSENT key
 * resolves through `defaultTransparentBackground()`, which is opaque on
 * Windows and transparent everywhere else. The assertions below compare
 * against that function rather than a literal, so the suite means the same
 * thing on every platform; the platform split itself is pinned separately.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// Stub the theme registry to a controlled set so the fallback assertions
// don't depend on the full bundled-theme list.
vi.mock("../../src/tui/context/theme-core", () => ({
  FOCUS_ACCENT_SLOTS: ["primary", "success", "info"] as const,
  hasBundledTheme: (name: string) => ["claude", "tokyonight"].includes(name),
}))

const { defaultTransparentBackground, readPersistedUiPrefs } = await import("../../src/tui/lib/persisted-ui-prefs.ts")

/** What an unset `transparentBackground` resolves to on THIS platform. */
const UNSET_TRANSPARENT = defaultTransparentBackground()

let home: string
let prevHome: string | undefined

function writeState(content: string): void {
  const dir = join(home, ".config", "rove")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "state.json"), content)
}

beforeEach(() => {
  prevHome = process.env.KOBE_HOME_DIR
  home = mkdtempSync(join(tmpdir(), "kobe-uiprefs-"))
  process.env.KOBE_HOME_DIR = home
})

afterEach(() => {
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = prevHome
  rmSync(home, { recursive: true, force: true })
})

describe("readPersistedUiPrefs", () => {
  test("reads valid persisted prefs", () => {
    writeState(
      JSON.stringify({
        activeTheme: "tokyonight",
        transparentBackground: true,
        focusAccent: "success",
        locale: "en",
      }),
    )
    expect(readPersistedUiPrefs("claude")).toEqual({
      theme: "tokyonight",
      transparent: true,
      focusAccent: "success",
      locale: "en",
    })
  })

  test("a stale/unknown theme name falls back to the caller's fallback", () => {
    writeState(JSON.stringify({ activeTheme: "deleted-user-theme" }))
    expect(readPersistedUiPrefs("claude").theme).toBe("claude")
  })

  // A host that loaded ~/.kobe/themes first knows more than the bundled set.
  // Without this seam every `kobe theme add` theme reverts to the fallback on
  // the next boot — which is most themes now that only three ship bundled.
  test("a caller-supplied registry check keeps a user-installed theme", () => {
    writeState(JSON.stringify({ activeTheme: "gruvbox" }))
    expect(readPersistedUiPrefs("claude").theme).toBe("claude")
    const knows = (name: string) => ["claude", "tokyonight", "gruvbox"].includes(name)
    expect(readPersistedUiPrefs("claude", knows).theme).toBe("gruvbox")
  })

  test("the caller's check still rejects a name it doesn't know", () => {
    writeState(JSON.stringify({ activeTheme: "uninstalled" }))
    expect(readPersistedUiPrefs("claude", (n) => n === "gruvbox").theme).toBe("claude")
  })

  test("each field validates independently — garbage in one doesn't poison the others", () => {
    writeState(
      JSON.stringify({
        activeTheme: "claude",
        transparentBackground: "yes", // garbage → the platform default; only a real boolean overrides
        focusAccent: "not-a-slot",
        locale: "xx-nope",
      }),
    )
    const prefs = readPersistedUiPrefs("claude")
    expect(prefs.theme).toBe("claude")
    expect(prefs.transparent).toBe(UNSET_TRANSPARENT)
    expect(prefs.focusAccent).toBeNull()
    expect(prefs.locale).toBe("en") // DEFAULT_LOCALE
  })

  test("missing or corrupt state.json yields full defaults, never throws", () => {
    // no file at all
    expect(readPersistedUiPrefs("claude")).toEqual({
      theme: "claude",
      transparent: UNSET_TRANSPARENT,
      focusAccent: null,
      locale: "en",
    })
    // An explicitly stored boolean always wins over the platform default,
    // in BOTH directions — a Windows user who chose transparency keeps it.
    writeState(JSON.stringify({ transparentBackground: false }))
    expect(readPersistedUiPrefs("claude").transparent).toBe(false)
    writeState(JSON.stringify({ transparentBackground: true }))
    expect(readPersistedUiPrefs("claude").transparent).toBe(true)
    writeState("{corrupt")
    expect(readPersistedUiPrefs("claude").theme).toBe("claude")
    expect(readPersistedUiPrefs("claude").transparent).toBe(UNSET_TRANSPARENT)
  })
})

describe("defaultTransparentBackground", () => {
  // Windows Terminal ships acrylic/background images on by default, and in
  // transparent mode nothing in Rove paints an opaque cell — so any cell the
  // renderer skips shows the wallpaper instead of the last frame. Opaque is
  // the Windows default; every POSIX platform keeps transparency.
  test("opaque on Windows, transparent everywhere else", () => {
    expect(defaultTransparentBackground("win32")).toBe(false)
    expect(defaultTransparentBackground("darwin")).toBe(true)
    expect(defaultTransparentBackground("linux")).toBe(true)
  })
})

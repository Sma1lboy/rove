/** @jsxImportSource @opentui/react */
import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { type KVContext, useKV } from "../../src/tui-react/context/kv"
import {
  focusAccent,
  selectedTheme,
  setFocusAccent,
  setTheme,
  setThemeMode,
  setTransparentBackground,
  themeMode,
  transparentBackground,
} from "../../src/tui-react/context/theme"
import { act, renderComponent, settle } from "./harness"

const savedHome = process.env.ROVE_HOME_DIR
afterAll(() => {
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
})

let kv: KVContext | undefined
function Driver() {
  kv = useKV()
  return <SettingsDialog kv={kv} onClose={() => {}} />
}
const initial = {
  activeTheme: "claude",
  transparentBackground: false,
  focusAccent: "primary",
  "appearance.splitStyle": "box",
  "sidebar.foldStyle": "glyphs",
}

async function setup(width = 120, height = 48) {
  const home = mkdtempSync(join(tmpdir(), "rove-appearance-test-"))
  process.env.ROVE_HOME_DIR = home
  const dir = join(home, ".config", "rove")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "state.json")
  writeFileSync(path, JSON.stringify(initial))
  setTheme("claude")
  setThemeMode("dark")
  setFocusAccent("primary")
  setTransparentBackground(false)
  const h = await renderComponent(<Driver />, { width, height, providers: { kv: true, dialog: true } })
  async function press(key: string) {
    act(() => (key === "return" ? h.mockInput.pressEnter() : h.mockInput.pressKey(key)))
    return h.frame()
  }
  async function pressEscape() {
    act(() => h.mockInput.pressEscape())
    // The lone ESC byte waits out opentui's escape-sequence window (see `settle`).
    await settle()
    return h.frame()
  }
  async function pressTimes(key: string, n: number) {
    for (let i = 0; i < n; i++) await press(key)
  }
  return { ...h, press, pressEscape, pressTimes, persisted: () => JSON.parse(readFileSync(path, "utf8")) }
}

describe("appearance choices", () => {
  const cases = [
    { row: 2, key: "activeTheme", next: "conductor", label: "Theme" },
    { row: 4, key: "transparentBackground", next: true, label: "Transparent background" },
    { row: 7, key: "sidebar.foldStyle", next: "initials", label: "Folded task rail" },
    { row: 9, key: "appearance.taskColors", next: "off", label: "Task colors" },
  ]
  it.each(cases)("$label: preview and cancel do not persist; Enter applies exactly one field", async (example) => {
    const h = await setup()
    await h.press("l")
    await h.pressTimes("j", example.row)
    expect(await h.press("return")).toContain(`Appearance / ${example.label}`)
    const original = h.persisted()
    const previewSpans = async () => {
      const lines = (await h.spans()).lines
      const start = lines.findLastIndex((line) => line.spans.some((span) => span.text.includes("Workspace preview")))
      const end = lines.findIndex(
        (line, index) =>
          index > start && line.spans.some((span) => /Opaque background|Transparent background/.test(span.text)),
      )
      expect(start).toBeGreaterThan(-1)
      expect(end).toBeGreaterThan(start)
      return lines.slice(start, end + 1)
    }
    const before = await previewSpans()
    await h.press("j")
    expect(await previewSpans()).not.toEqual(before)
    expect(h.persisted()).toEqual(original)
    expect(selectedTheme()).toBe("claude")
    expect(themeMode()).toBe("dark")
    expect(focusAccent()).toBe("primary")
    expect(transparentBackground()).toBe(false)
    expect(await h.pressEscape()).not.toContain(`Appearance / ${example.label}`)
    expect(h.persisted()).toEqual(original)
    await h.press("return")
    await h.press("j")
    await h.press("return")
    act(() => kv?.flush())
    expect(h.persisted()).toEqual({ ...original, [example.key]: example.next })
  })
})

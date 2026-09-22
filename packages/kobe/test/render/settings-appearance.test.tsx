/** @jsxImportSource @opentui/react */
import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
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

function Driver() {
  return <SettingsDialog kv={useKV()} onClose={() => {}} />
}
const initial = {
  activeTheme: "claude",
  transparentBackground: false,
  focusAccent: "primary",
  "appearance.splitStyle": "box",
  "sidebar.foldStyle": "glyphs",
  "sidebar.tabRowHeight": 1,
}

async function setup(width = 120, height = 48) {
  const home = mkdtempSync(join(tmpdir(), "rove-appearance-test-"))
  process.env.KOBE_HOME_DIR = home
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
    act(() =>
      key === "return"
        ? h.mockInput.pressEnter()
        : key === "escape"
          ? h.mockInput.pressEscape()
          : h.mockInput.pressKey(key),
    )
    await settle(40)
    return h.frame()
  }
  return { ...h, press, persisted: () => JSON.parse(readFileSync(path, "utf8")) }
}

describe("appearance choices", () => {
  const cases = [
    { row: 2, key: "activeTheme", next: "conductor", label: "Theme" },
    { row: 4, key: "transparentBackground", next: true, label: "Transparent background" },
    { row: 7, key: "sidebar.foldStyle", next: "initials", label: "Folded task rail" },
    { row: 8, key: "sidebar.tabRowHeight", next: 2, label: "Tab row height" },
  ]
  for (const example of cases) {
    it(`${example.label}: preview and cancel do not persist; Enter applies exactly one field`, async () => {
      const h = await setup()
      await h.press("l")
      for (let i = 0; i < example.row; i++) await h.press("j")
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
      expect(await h.press("escape")).not.toContain(`Appearance / ${example.label}`)
      expect(h.persisted()).toEqual(original)
      await h.press("return")
      await h.press("j")
      await h.press("return")
      await settle(320)
      expect(h.persisted()).toEqual({ ...original, [example.key]: example.next })
    })
  }
})

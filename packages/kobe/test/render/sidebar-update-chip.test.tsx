/** @jsxImportSource @opentui/react */
/**
 * The brand-row update chip — the passive half of the update surface. The
 * daemon's npm poll lands in `updateSignal`; this pins that a `hasUpdate`
 * payload renders a right-aligned, clickable chip on the ROVE brand row and
 * that no chip renders otherwise — with no consumer, the poll runs and its
 * result goes nowhere, silently.
 */

import { expect, test } from "bun:test"
import {
  DEFAULT_THEME,
  type ThemeJson,
  ThemeProvider,
  addTheme,
  setTheme,
  setThemeMode,
} from "../../src/tui-react/context/theme"
import { SidebarBrandHeader } from "../../src/tui-react/panes/sidebar/chrome"
import { renderComponent } from "./harness"

function lineOf(frame: string, needle: string): number {
  return frame.split("\n").findIndex((line) => line.includes(needle))
}

test("renders the update chip right-aligned on the brand row", async () => {
  const { frame } = await renderComponent(
    <SidebarBrandHeader
      focused={false}
      status={{ label: "Inbox 0", emphasize: false }}
      update={{ label: "↑ 0.9.99" }}
    />,
    { width: 30, height: 3 },
  )
  const text = await frame()
  const row = text.split("\n")[lineOf(text, "ROVE")]

  // Same row as the brand text, version label intact, pushed to the right edge.
  expect(row).toMatch(/ROVE\s+Inbox 0\s+↑ 0\.9\.99/)
})

test("no update chip when there is nothing to update to", async () => {
  const { frame } = await renderComponent(
    <SidebarBrandHeader focused={false} status={{ label: "Inbox 0", emphasize: false }} update={null} />,
    { width: 30, height: 3 },
  )
  expect(await frame()).not.toContain("↑")
})

test("clicking the chip opens the update surface", async () => {
  let calls = 0
  const { frame, mockMouse } = await renderComponent(
    <SidebarBrandHeader
      focused={false}
      status={{ label: "Inbox 0", emphasize: false }}
      update={{ label: "↑ 0.9.99" }}
      onUpdateClick={() => calls++}
    />,
    { width: 30, height: 3 },
  )
  const text = await frame()
  const row = lineOf(text, "0.9.99")

  await mockMouse.click(text.split("\n")[row].indexOf("0.9.99"), row)
  expect(calls).toBe(1)
})

test("uses the configured warning color for the update chip", async () => {
  const name = "sidebar-update-chip-test"
  expect(
    addTheme(name, {
      theme: {
        background: "#000000",
        text: "#ffffff",
        textMuted: "#999999",
        warning: { dark: "#ffaa00", light: "#aa5500" },
        success: { dark: "#00aa55", light: "#0055aa" },
      },
    } satisfies ThemeJson),
  ).toBe(true)

  try {
    const cases: Array<{
      mode: "dark" | "light"
      warning: [number, number, number, number]
    }> = [
      { mode: "dark", warning: [255, 170, 0, 255] },
      { mode: "light", warning: [170, 85, 0, 255] },
    ]
    for (const { mode, warning } of cases) {
      const handle = await renderComponent(
        <ThemeProvider theme={name} mode={mode}>
          <SidebarBrandHeader focused={false} status={null} update={{ label: "↑ 0.9.99" }} />
        </ThemeProvider>,
        { width: 30, height: 3, providers: { theme: false } },
      )
      try {
        const updateSpan = (await handle.spans()).lines
          .flatMap((line) => line.spans)
          .find((span) => span.text.includes("0.9.99"))
        expect(updateSpan?.fg.toInts()).toEqual(warning)
      } finally {
        handle.destroy()
      }
    }
  } finally {
    setTheme(DEFAULT_THEME)
    setThemeMode("dark")
  }
})

/** @jsxImportSource @opentui/react */
import { expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { useTheme } from "../../src/tui-react/context/theme"
import { act, renderComponent, settle } from "./harness"

it("shows failed feedback submission and its recovery hint in warning colors", async () => {
  const previousHome = process.env.ROVE_HOME_DIR ?? ""
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-feedback-failure-"))
  let theme: ReturnType<typeof useTheme>["theme"] | undefined
  function Driver() {
    theme = useTheme().theme
    return <SettingsDialog kv={useKV()} onClose={() => {}} />
  }
  try {
    const r = await renderComponent(<Driver />, { width: 110, height: 40, providers: { kv: true, dialog: true } })
    for (const key of ["k", "k", "l"]) {
      await act(async () => {
        r.mockInput.pressKey(key)
        await settle()
      })
    }
    for (let field = 0; field < 2; field++) {
      await act(async () => {
        r.mockInput.pressTab()
        await settle()
      })
    }
    // An empty title fails validation before the GitHub submission path.
    await act(async () => {
      r.mockInput.pressEnter()
      await settle()
    })
    const frame = await r.frame()
    expect(frame).toContain("feedback title is required")
    expect(frame).toContain("rove doctor")
    const spans = (await r.spans()).lines.flatMap((line) => line.spans)
    for (const text of ["feedback title is required", "rove doctor"]) {
      const span = spans.find((candidate) => candidate.text.includes(text))
      expect(span).toBeDefined()
      expect(span?.fg.equals(theme?.warning)).toBe(true)
      expect(span?.fg.equals(theme?.success)).toBe(false)
    }
  } finally {
    process.env.ROVE_HOME_DIR = previousHome
  }
})

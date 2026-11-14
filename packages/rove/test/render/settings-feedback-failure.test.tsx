/** @jsxImportSource @opentui/react */
import { afterAll, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { useTheme } from "../../src/tui-react/context/theme"
import { act, renderComponent } from "./harness"

const savedHome = process.env.ROVE_HOME_DIR
afterAll(() => {
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
})

it("shows failed feedback submission and its recovery hint in warning colors", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-feedback-failure-"))
  let theme: ReturnType<typeof useTheme>["theme"] | undefined
  function Driver() {
    theme = useTheme().theme
    return <SettingsDialog kv={useKV()} onClose={() => {}} />
  }
  const r = await renderComponent(<Driver />, { width: 110, height: 40, providers: { kv: true, dialog: true } })
  const press = async (fire: () => void) => {
    act(fire)
    await r.frame()
  }
  // Feedback is the last section: two up from the top wraps into it.
  await press(() => r.mockInput.pressKey("k"))
  await press(() => r.mockInput.pressKey("k"))
  await press(() => r.mockInput.pressKey("l"))
  await press(() => r.mockInput.pressTab())
  await press(() => r.mockInput.pressTab())
  // An empty title fails validation before the GitHub submission path.
  act(() => r.mockInput.pressEnter())
  const frame = await r.frame()
  expect(frame).toContain("feedback title is required")
  expect(frame).toContain("rove doctor")
  const spans = (await r.spans()).lines.flatMap((line) => line.spans)
  const required = spans.find((candidate) => candidate.text.includes("feedback title is required"))
  expect(required?.fg.equals(theme?.warning)).toBe(true)
  expect(required?.fg.equals(theme?.success)).toBe(false)
  const hint = spans.find((candidate) => candidate.text.includes("rove doctor"))
  expect(hint?.fg.equals(theme?.warning)).toBe(true)
  expect(hint?.fg.equals(theme?.success)).toBe(false)
})

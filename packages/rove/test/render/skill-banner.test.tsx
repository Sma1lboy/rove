/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { SkillBanner } from "../../src/tui-react/component/version-skew-banner"
import { act, renderComponent } from "./harness"

test("the skill banner names the engines and installs on click", async () => {
  let installs = 0
  const { frame, mockMouse } = await renderComponent(
    <SkillBanner engines={["Claude", "Codex"]} error={null} onInstall={() => installs++} width={100} />,
    { width: 100, height: 8 },
  )
  await act(async () => {})
  const text = await frame()
  expect(text).toContain("ROVE SKILL NOT INSTALLED")
  expect(text).toContain("Claude, Codex can't drive Rove yet")
  const row = text.split("\n").findIndex((line) => line.includes("Click here to install"))
  await act(async () => mockMouse.click(10, row))
  expect(installs).toBe(1)
})

test("nothing missing, no banner", async () => {
  const { frame } = await renderComponent(<SkillBanner engines={[]} error={null} onInstall={() => {}} width={100} />, {
    width: 100,
    height: 8,
  })
  await act(async () => {})
  expect((await frame()).trim()).toBe("")
})

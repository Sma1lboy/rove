/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { WelcomeDialogView } from "../../src/tui-react/onboarding/host"
import { act, renderComponent } from "./harness"

test("signed-out first run explains login before offering optional installs", async () => {
  const { frame, mockInput } = await renderComponent(
    <WelcomeDialogView
      shell="zsh"
      probe={() => Promise.resolve({ engines: [], signedOut: ["codex"], git: true })}
      onDone={() => {}}
    />,
    { width: 110, height: 35 },
  )
  await act(async () => {})
  const text = await frame()
  expect(text).toContain("No usable engine yet")
  expect(text).toContain("Codex: installed, not signed in")
  expect(text).toContain("run its CLI and sign in")
  expect(text).not.toContain("Shell completions")
  act(() => mockInput.pressEnter())
  expect(await frame()).toContain("Shell completions for")
})

test("an unresolved engine check cannot be skipped with enter", async () => {
  const { frame, mockInput } = await renderComponent(
    <WelcomeDialogView shell={null} probe={() => new Promise(() => {})} onDone={() => {}} />,
  )
  act(() => mockInput.pressEnter())
  expect(await frame()).toContain("Checking installed engines")
  expect(await frame()).not.toContain("Rove agent skill")
})

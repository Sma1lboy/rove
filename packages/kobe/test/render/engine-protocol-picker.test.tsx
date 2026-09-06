/** @jsxImportSource @opentui/react */
/**
 * The protocol step of the add-engine flow is a PICK, not a text field.
 *
 * What that buys is the thing this suite pins: every value the step can
 * produce is on screen, and the generic adapter — the one a custom engine
 * silently fell back to when free text failed validation — is a row you land
 * on deliberately. So: the list offers each built-in plus None, `enter`
 * commits the row under the cursor, and the None row resolves to the empty
 * string that `addEngineFlow` reads as "declare nothing".
 */

import { expect, test } from "bun:test"
import { ENGINE_PROTOCOLS } from "../../src/engine/engine-presets"
import { EngineProtocolPickerDialogView } from "../../src/tui-react/component/engine-protocol-picker-dialog"
import { act, renderComponent, settle } from "./harness"

const NOOP = (): void => {}

async function mount(onSubmit: (protocol: string) => void) {
  const handle = await renderComponent(
    <EngineProtocolPickerDialogView engineId="aider" onSubmit={onSubmit} onCancel={NOOP} />,
    { width: 80, height: 20, providers: { kv: true, dialog: true } },
  )
  return handle
}

test("offers every built-in protocol plus a None row, under the engine's own title", async () => {
  const { frame } = await mount(NOOP)
  const text = await frame()
  expect(text).toContain("aider")
  for (const protocol of ENGINE_PROTOCOLS) expect(text).toContain(protocol)
  expect(text).toContain("None")
})

test("enter commits the row under the cursor", async () => {
  const picked: string[] = []
  const { mockInput } = await mount((p) => picked.push(p))
  // One row down from the top of the list — the second built-in, so a picker
  // that ignored the cursor and always committed the first would fail here.
  act(() => mockInput.pressArrow("down"))
  await settle()
  act(() => mockInput.pressEnter())
  await settle()
  expect(picked).toEqual([ENGINE_PROTOCOLS[1] as string])
})

test("the None row resolves to the empty string, not a protocol name", async () => {
  const picked: string[] = []
  const { mockInput } = await mount((p) => picked.push(p))
  // None is last: walking past the end clamps, so this lands on it from any
  // list length without hard-coding one.
  for (let i = 0; i < ENGINE_PROTOCOLS.length + 2; i++) {
    act(() => mockInput.pressArrow("down"))
    await settle()
  }
  act(() => mockInput.pressEnter())
  await settle()
  expect(picked).toEqual([""])
})

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
import { act, isolateHome, renderComponent, settle } from "./harness"

isolateHome()

const NOOP = (): void => {}

async function mount(onSubmit: (protocol: string) => void) {
  const handle = await renderComponent(
    <EngineProtocolPickerDialogView engineId="aider" onSubmit={onSubmit} onCancel={NOOP} />,
    { width: 80, height: 20, providers: { kv: true, dialog: true } },
  )
  return handle
}

/** Arrow down `n` times; the cursor update is functional, so the presses need no wait between them. */
function pressDown(mockInput: Awaited<ReturnType<typeof mount>>["mockInput"], n: number): void {
  act(() => {
    for (let i = 0; i < n; i++) mockInput.pressArrow("down")
  })
}

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
  pressDown(mockInput, ENGINE_PROTOCOLS.length + 2)
  await settle()
  act(() => mockInput.pressEnter())
  await settle()
  expect(picked).toEqual([""])
})

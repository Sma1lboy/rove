/** @jsxImportSource @opentui/react */
/**
 * Unified new-conversation dialog (issue #7) — REAL keypresses against the
 * mounted view: enter in the pristine state must reproduce the old ctrl+e
 * result exactly, `tab` / `ctrl+f` flip the destination / context toggles
 * (footer reflects them live), shell-only choices clamp onto an engine when
 * a toggle leaves the default combo, and preset props open pre-flipped.
 */

import { describe, expect, test } from "bun:test"
import { type NewChatChoice, NewChatDialog, NewChatDialogView } from "../../src/tui-react/component/new-chat-dialog"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { type DialogContext, useDialog } from "../../src/tui-react/ui/dialog"
import { type RenderHandle, act, renderComponent } from "./harness"

function mount(
  overrides: Partial<Parameters<typeof NewChatDialogView>[0]> = {},
): Promise<RenderHandle> & { choices: NewChatChoice[] } {
  const choices: NewChatChoice[] = []
  const p = renderComponent(
    <NewChatDialogView
      availableVendors={["claude", "codex"]}
      defaultVendor="claude"
      allowShell={true}
      onSubmit={(c) => choices.push(c)}
      onCancel={() => {}}
      {...overrides}
    />,
    { providers: { dialog: true } },
  ) as Promise<RenderHandle> & { choices: NewChatChoice[] }
  p.choices = choices
  return p
}

function SiblingBindings(props: { onTab: () => void }) {
  useBindings(() => ({
    enabled: true,
    bindings: [{ key: "tab", cmd: props.onTab }],
  }))
  return null
}

describe("NewChatDialogView", () => {
  test("pristine enter = the old ctrl+e result: default engine, tab here, fresh", async () => {
    const p = mount()
    const { frame, mockInput } = await p
    const first = await frame()
    expect(first).toContain("New conversation")
    expect(first).toContain("shell")
    expect(first).toContain("new tab in this worktree")
    expect(first).toContain("fresh conversation")
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.choices).toEqual([{ pick: "claude", destination: "tab", context: "fresh" }])
  })

  test("tab and ctrl+f flip the toggles, footer tracks them, enter carries both", async () => {
    const p = mount()
    const { frame, mockInput } = await p
    act(() => mockInput.pressTab())
    expect(await frame()).toContain("fork a child task")
    act(() => mockInput.pressKey("f", { ctrl: true }))
    expect(await frame()).toContain("continue this conversation")
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.choices).toEqual([{ pick: "claude", destination: "fork", context: "continue" }])
  })

  test("toggles flip back — tab twice returns to the default combo", async () => {
    const p = mount()
    const { frame, mockInput } = await p
    act(() => mockInput.pressTab())
    act(() => mockInput.pressTab())
    const back = await frame()
    expect(back).toContain("new tab in this worktree")
    expect(back).toContain("shell")
  })

  test("shell highlight clamps onto an engine when the combo leaves default", async () => {
    const p = mount({ availableVendors: ["claude"] })
    const { frame, mockInput } = await p
    // claude → shell (one step right), then flip destination: shell rows
    // don't exist in a forked task, so the pick must clamp back to claude.
    act(() => mockInput.pressArrow("right"))
    act(() => mockInput.pressTab())
    expect(await frame()).not.toContain("shell")
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.choices).toEqual([{ pick: "claude", destination: "fork", context: "fresh" }])
  })

  test("dialog tab wins over a sibling binding mounted before the overlay", async () => {
    const dialogRef: { current: DialogContext | null } = { current: null }
    let siblingTabFired = false
    function Host() {
      const dialog = useDialog()
      dialogRef.current = dialog
      return (
        <>
          <SiblingBindings
            onTab={() => {
              siblingTabFired = true
            }}
          />
          <text>workspace</text>
        </>
      )
    }
    const { frame, mockInput } = await renderComponent(<Host />, { providers: { dialog: true } })
    expect(await frame()).toContain("workspace")
    let choice: NewChatChoice | undefined
    act(() => {
      void NewChatDialog.show(dialogRef.current!, ["claude", "codex"], "claude", {
        allowShell: true,
      }).then((c) => {
        choice = c
      })
    })
    await frame()
    expect(await frame()).toContain("new tab in this worktree")
    act(() => mockInput.pressTab())
    await frame()
    expect(siblingTabFired).toBe(false)
    expect(await frame()).toContain("fork a child task")
  })

  test("preset props open the dialog pre-flipped (prefix entries)", async () => {
    const p = mount({ initialDestination: "fork" })
    const handle = await p
    const first = await handle.frame()
    expect(first).toContain("fork a child task")
    expect(first).toContain("fresh conversation")
    handle.destroy()

    const q = mount({ initialContext: "continue" })
    const second = await (await q).frame()
    expect(second).toContain("new tab in this worktree")
    expect(second).toContain("continue this conversation")
  })
})

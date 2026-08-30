/** @jsxImportSource @opentui/react */
/**
 * DialogConfirm danger contract (owner report 2026-08-30): destructive
 * confirms used to open with focus on the confirm button, so one stray
 * Enter destroyed uncommitted work. `danger` must (1) land initial focus
 * on Cancel, (2) draw the confirm button in the error color — the same
 * `danger` → `theme.error` convention ContextMenuEntry uses — while plain
 * confirms keep confirm-first focus for one-keystroke dismissal.
 */
import { describe, expect, it } from "bun:test"
import type { CapturedFrame } from "@opentui/core"
import { useEffect } from "react"
import { DialogProvider, useDialog } from "../../src/tui-react/ui/dialog"
import { DialogConfirm, type DialogConfirmResult } from "../../src/tui-react/ui/dialog-confirm"
import { BUNDLED_THEMES, DEFAULT_THEME, applyDisplayOverlay, resolveTheme } from "../../src/tui/context/theme-core"
import { act, renderComponent, settle } from "./harness"

// Mirror the harness's ThemeProvider defaults: claude theme, dark mode,
// transparent background, primary focus accent.
const theme = applyDisplayOverlay(resolveTheme(BUNDLED_THEMES[DEFAULT_THEME], "dark"), "primary", true)

function findSpan(frame: CapturedFrame, label: string) {
  return frame.lines.flatMap((line) => line.spans).find((span) => span.text.trim() === label)
}

/** Mount a real DialogConfirm inside the dialog provider, counting commits. */
async function mountConfirm(props: { danger?: boolean; initialActive?: "confirm" | "cancel" }) {
  const commits = { confirm: 0, cancel: 0 }
  const handle = await renderComponent(
    <DialogConfirm
      title="Force delete worktree?"
      message="Uncommitted work will be PERMANENTLY LOST. Force delete anyway?"
      danger={props.danger}
      initialActive={props.initialActive}
      onConfirm={() => commits.confirm++}
      onCancel={() => commits.cancel++}
    />,
    { providers: { dialog: true } },
  )
  return { ...handle, commits }
}

/** Drive the imperative surface real callers use, capturing the resolution. */
let reshow: (() => void) | undefined
function ShowDriver(props: { onResult: (result: DialogConfirmResult) => void }) {
  const dialog = useDialog()
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once, matching the Solid setup semantics.
  useEffect(() => {
    reshow = () => {
      void DialogConfirm.show(
        dialog,
        "Force delete worktree?",
        "Uncommitted work will be PERMANENTLY LOST. Force delete anyway?",
        "cancel",
        "force delete",
        { danger: true },
      ).then(props.onResult)
    }
    reshow()
  }, [])
  return <text>base content</text>
}

describe("DialogConfirm danger", () => {
  it("opens with focus on Cancel — a stray Enter deletes nothing", async () => {
    const { mockInput, spans, commits } = await mountConfirm({ danger: true })

    // The regression: Enter on a freshly opened destructive confirm must NOT
    // commit the destructive action.
    act(() => mockInput.pressEnter())
    await settle()
    expect(commits.confirm).toBe(0)
    expect(commits.cancel).toBe(1)

    // Focus sat on Cancel (primary fill); the idle confirm button carries the
    // danger color, matching the context-menu `danger` convention.
    const frame = await spans()
    expect(findSpan(frame, "Cancel")?.bg.equals(theme.primary)).toBe(true)
    expect(findSpan(frame, "Confirm")?.fg.equals(theme.error)).toBe(true)
  })

  it("confirms only after the user moves focus onto the confirm button", async () => {
    const { mockInput, spans, commits } = await mountConfirm({ danger: true })

    act(() => mockInput.pressArrow("right"))
    await settle()
    // The focused danger button is drawn in the error color, not primary.
    const focused = await spans()
    expect(findSpan(focused, "Confirm")?.bg.equals(theme.error)).toBe(true)
    expect(findSpan(focused, "Confirm")?.fg.equals(theme.selectedListItemText)).toBe(true)

    act(() => mockInput.pressEnter())
    await settle()
    expect(commits.confirm).toBe(1)
    expect(commits.cancel).toBe(0)
  })

  it("plain confirms keep confirm-first focus", async () => {
    const { mockInput, spans, commits } = await mountConfirm({})

    act(() => mockInput.pressEnter())
    await settle()
    expect(commits.confirm).toBe(1)

    const frame = await spans()
    expect(findSpan(frame, "Confirm")?.bg.equals(theme.primary)).toBe(true)
  })

  it("explicit initialActive still wins over the danger default", async () => {
    const { mockInput, commits } = await mountConfirm({ danger: true, initialActive: "confirm" })

    act(() => mockInput.pressEnter())
    await settle()
    expect(commits.confirm).toBe(1)
  })

  it("DialogConfirm.show threads danger through its options", async () => {
    const results: DialogConfirmResult[] = []
    const { frame, mockInput } = await renderComponent(
      <DialogProvider>
        <ShowDriver onResult={(result) => results.push(result)} />
      </DialogProvider>,
    )
    expect(await frame()).toContain("PERMANENTLY LOST")

    // Stray Enter: resolves false (cancelled), not true (confirmed).
    act(() => mockInput.pressEnter())
    await settle()
    expect(results).toEqual([false])

    // Reopen and commit deliberately: right to focus the danger button, Enter.
    act(() => reshow?.())
    await settle()
    act(() => mockInput.pressArrow("right"))
    await settle()
    act(() => mockInput.pressEnter())
    await settle()
    expect(results).toEqual([false, true])
  })
})

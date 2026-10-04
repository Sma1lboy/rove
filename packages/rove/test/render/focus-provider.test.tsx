/** @jsxImportSource @opentui/react */
/**
 * FocusProvider — pane focus context (src/tui-react/context/focus.tsx). Imports
 * @opentui/react (useRenderer) so it can't run under vitest at all; this is its
 * only coverage. Drives the real `focused`/`is`/`cycle`/`setFocused` surface
 * every pane wrapper reads.
 */
import { describe, expect, it } from "bun:test"
import { FocusProvider, type PaneId, useFocus } from "../../src/tui-react/context/focus"
import { act, renderComponent } from "./harness"

describe("FocusProvider", () => {
  it("setFocused moves focus and cycle wraps through PANE_ORDER", async () => {
    let cycleFn: ((delta: 1 | -1) => void) | undefined
    let setFocusedFn: ((pane: PaneId) => void) | undefined
    function Driver() {
      const focus = useFocus()
      cycleFn = focus.cycle
      setFocusedFn = focus.setFocused
      return <text>{`focused:${focus.focused}`}</text>
    }
    const { frame } = await renderComponent(
      <FocusProvider>
        <Driver />
      </FocusProvider>,
    )
    expect(await frame()).toContain("focused:sidebar")

    act(() => setFocusedFn?.("files"))
    expect(await frame()).toContain("focused:files")

    act(() => cycleFn?.(1)) // files -> terminal
    expect(await frame()).toContain("focused:terminal")

    act(() => cycleFn?.(1)) // terminal wraps back to sidebar
    expect(await frame()).toContain("focused:sidebar")
  })
})

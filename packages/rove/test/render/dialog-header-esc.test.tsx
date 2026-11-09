/** @jsxImportSource @opentui/react */
import { expect, it } from "bun:test"
import { RenameTaskDialog } from "../../src/tui-react/component/rename-task-dialog"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { act, renderComponent, settle } from "./harness"

it("clicking a dialog header's esc takes the dialog off the screen", async () => {
  const results: unknown[] = []
  function Opener() {
    const dialog = useDialog()
    return (
      <text
        onMouseUp={() => {
          void RenameTaskDialog.show(dialog, "Fixture", { dialogTitle: "RENAME-ME" }).then((v) => results.push(v))
        }}
      >
        OPEN
      </text>
    )
  }
  const r = await renderComponent(<Opener />, { width: 80, height: 30, providers: { dialog: true } })
  await act(async () => {
    await r.mockMouse.click(1, 0)
    await settle()
  })
  const rows = (await r.frame()).split("\n")
  const y = rows.findIndex((row) => row.includes("RENAME-ME"))
  expect(y).toBeGreaterThanOrEqual(0)
  await act(async () => {
    await r.mockMouse.click((rows[y] ?? "").lastIndexOf("esc") + 1, y)
    await settle()
  })
  expect(await r.frame()).not.toContain("RENAME-ME")
  expect(results).toEqual([undefined])
})

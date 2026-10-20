/** @jsxImportSource @opentui/react */
import { expect, it } from "bun:test"
import { failureHint } from "../../src/lib/failure-hint"
import { FailureHint } from "../../src/tui-react/component/failure-hint"
import { renderComponent } from "./harness"

it("keeps structured next steps and shell-quotes command arguments", () => {
  expect(failureHint({ hint: "Choose a task", nextCommandArgs: ["api", "list"] })).toBe("Choose a task\nrove api list")
  expect(failureHint({ nextCommandArgs: ["api", "get-task", "--task-id", "a'b"] })).toContain("'a'\\''b'")
  expect(failureHint({ nextCommandArgs: [false] })).toContain("rove doctor")
})

it("renders a next step when an inline failure has no structured remediation", async () => {
  const r = await renderComponent(<FailureHint error={new Error("disk full")} />)
  expect(await r.frame()).toContain("Run `rove doctor`")
})

/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { resolveMainRepoRoot } from "../../src/state/repos"
import type { QuickTaskResult } from "../../src/tui-react/component/quick-task-composer"
import { FirstTaskStart, firstTaskRepo } from "../../src/tui-react/workspace/first-task-start"
import { getCurrentBranch } from "../../src/tui/lib/git-snapshot"
import { act, renderComponent } from "./harness"

test("the first-task action opens a prompt-focused composer with cwd defaults", async () => {
  const created: Array<{ repo: string; result: QuickTaskResult }> = []
  const { frame, mockMouse, mockInput } = await renderComponent(
    <FirstTaskStart
      env={{ engines: ["codex"], signedOut: [], git: true }}
      onCreate={(repo, result) => created.push({ repo, result })}
    />,
    { width: 110, height: 35, providers: { dialog: true } },
  )
  const lines = (await frame()).split("\n")
  const y = lines.findIndex((line) => line.includes("Start a task"))
  const x = lines[y]!.indexOf("Start a task")
  await act(async () => {
    await mockMouse.click(x + 1, y)
  })
  expect(await frame()).toContain("Creates an isolated worktree and branch")
  await act(async () => {
    await mockInput.typeText("Explain the project")
  })
  act(() => mockInput.pressEnter())
  await act(async () => {})
  expect(created).toHaveLength(1)
  expect(created[0]?.repo).toBe(resolveMainRepoRoot(process.cwd()))
  expect(created[0]?.result).toMatchObject({
    prompt: "Explain the project",
    vendor: "codex",
    baseRef: getCurrentBranch(process.cwd()),
    attempts: 1,
  })
})

test("no quick action is offered until an engine is usable", async () => {
  const { frame } = await renderComponent(
    <FirstTaskStart env={{ engines: [], signedOut: ["codex"], git: true }} onCreate={() => {}} />,
    { providers: { dialog: true } },
  )
  expect((await frame()).trim()).toBe("")
  expect(firstTaskRepo(tmpdir())).toBeNull()
})

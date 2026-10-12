/** @jsxImportSource @opentui/react */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveMainRepoRoot } from "../../src/state/repos"
import type { QuickTaskResult } from "../../src/tui-react/component/quick-task-composer"
import { FirstTaskStart, firstTaskRepo } from "../../src/tui-react/workspace/first-task-start"
import { act, renderComponent } from "./harness"

let previousCwd: string
beforeEach(() => {
  previousCwd = process.cwd()
  const repo = mkdtempSync(join(tmpdir(), "rove-first-task-"))
  for (const args of [
    ["init", "-b", "first-task-base"],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@rove.local",
      "commit",
      "--allow-empty",
      "-m",
      "Initial fixture",
    ],
  ]) {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" })
    if (result.status !== 0) throw new Error(result.stderr)
  }
  process.chdir(repo)
})
afterEach(() => {
  process.chdir(previousCwd)
})

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
    baseRef: "first-task-base",
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

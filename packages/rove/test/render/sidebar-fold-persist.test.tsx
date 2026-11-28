/** @jsxImportSource @opentui/react */
/** A parent's folded children stay folded across a TUI restart (a fresh KV read of state.json). */

import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { type Task, toTaskId } from "@sma1lboy/rove-core/types/task.ts"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { COLLAPSED_TASKS_KEY } from "../../src/tui-react/panes/sidebar/use-tree-state"
import { resetRowStatusForTests } from "../../src/tui-react/workspace/row-status-sync"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { renderComponent, waitForFrameText } from "./harness"

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }
}

const PARENT = toTaskId("parent")
const TASKS = [task("parent"), task("kid", { title: "check types", parentTaskId: PARENT })]

let home: string
let savedHome: string | undefined

beforeEach(() => {
  savedHome = process.env.ROVE_HOME_DIR
  home = fs.mkdtempSync(path.join(os.tmpdir(), "rove-fold-"))
  process.env.ROVE_HOME_DIR = home
})

afterEach(() => {
  resetRowStatusForTests()
  tabsByTask.clear()
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
  fs.rmSync(home, { recursive: true, force: true })
})

const mount = (tasks: readonly Task[] = TASKS) =>
  renderComponent(<SidebarTree tasks={tasks} selectedId="parent" onSelect={() => {}} focused={true} width={40} />, {
    width: 40,
    height: 14,
    providers: { kv: true },
  })

type Mounted = Awaited<ReturnType<typeof mount>>

const statePath = () => path.join(home, ".config", "rove", "state.json")
const readState = async () => (fs.existsSync(statePath()) ? fs.readFileSync(statePath(), "utf8") : "")

async function foldRow(view: Mounted, title: string, child: string): Promise<void> {
  const open = await waitForFrameText(view.frame, child)
  const lines = open.split("\n")
  const line = lines.find((l) => l.includes(title) && l.includes("v")) ?? ""
  await view.mockMouse.click(line.indexOf("v"), lines.indexOf(line), 0)
  expect(await view.frame()).not.toContain(child)
}

test("a folded parent is still folded after a restart", async () => {
  const first = await mount()
  const open = await waitForFrameText(first.frame, "check types")
  const line = open.split("\n").find((l) => l.includes("parent")) ?? ""
  await first.mockMouse.click(line.indexOf("v"), open.split("\n").indexOf(line), 0)
  expect(await first.frame()).not.toContain("check types")
  // The KV write is debounced: wait for it to reach state.json, as a quit's flush would.
  await waitForFrameText(readState, COLLAPSED_TASKS_KEY)
  first.destroy()

  const second = await mount()
  expect(await waitForFrameText(second.frame, "parent")).not.toContain("check types")
})

test("folds made in two windows both survive a restart", async () => {
  const OTHER = toTaskId("other")
  const tasks = [...TASKS, task("other"), task("kid2", { title: "run lint", parentTaskId: OTHER })]
  const left = await mount(tasks)
  const right = await mount(tasks)
  await foldRow(left, "parent", "check types")
  await waitForFrameText(readState, '"parent"')
  await foldRow(right, "other", "run lint")
  await waitForFrameText(readState, '"other"')
  left.destroy()
  right.destroy()

  const fresh = await mount(tasks)
  const frame = await waitForFrameText(fresh.frame, "other")
  expect(frame).not.toContain("check types")
  expect(frame).not.toContain("run lint")
})

/** @jsxImportSource @opentui/react */
/** A parent's folded children stay folded across a TUI restart (a fresh KV read of state.json). */

import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { resetRowStatusForTests } from "../../src/tui-react/workspace/row-status-sync"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { type Task, toTaskId } from "../../src/types/task"
import { renderComponent, settle } from "./harness"

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

const mount = () =>
  renderComponent(<SidebarTree tasks={TASKS} selectedId="parent" onSelect={() => {}} focused={true} width={40} />, {
    width: 40,
    height: 12,
    providers: { kv: true },
  })

test("a folded parent is still folded after a restart", async () => {
  const first = await mount()
  await settle(80)
  const open = await first.frame()
  expect(open).toContain("check types")
  const line = open.split("\n").find((l) => l.includes("parent")) ?? ""
  await first.mockMouse.click(line.indexOf("▾"), open.split("\n").indexOf(line), 0)
  await settle(400)
  expect(await first.frame()).not.toContain("check types")
  first.destroy()

  const second = await mount()
  await settle(80)
  expect(await second.frame()).not.toContain("check types")
})

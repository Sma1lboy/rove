/**
 * `ctrl+a f` hands `useQuickFork().onQuickFork` the source task; the hook must turn "continue from the source's own
 * branch" into a clone request (`forkFrom`), or the fork silently starts from the last commit and the uncommitted
 * work stays behind — with no toast, because nothing was refused.
 */

import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { QuickTaskResult } from "../../src/tui-react/component/quick-task-composer"
import {
  type QuickForkOrchestrator,
  type UseQuickForkResult,
  useQuickFork,
} from "../../src/tui-react/workspace/quick-fork"
import { type Task, toTaskId } from "../../src/types/task"
import { act, renderComponent } from "./harness"

let savedHome: string | undefined

beforeEach(() => {
  savedHome = process.env.ROVE_HOME_DIR
  // The create path records the repo and engine preference; keep that out of the operator's state.json.
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-quick-fork-source-"))
})

afterEach(() => {
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
})

async function forkWith(source: { taskId: string; branch: string | null }, baseRef: string) {
  const created: Array<{ forkFrom?: string; baseRef: string }> = []
  const { promise: createCalled, resolve } = Promise.withResolvers<void>()
  const orch = {
    async createTask(input: { forkFrom?: string; baseRef: string }) {
      created.push(input)
      resolve()
      return { id: toTaskId("child") } as Task
    },
    async setPrompt() {},
  } as unknown as QuickForkOrchestrator
  let hook: UseQuickForkResult | undefined
  function Probe() {
    hook = useQuickFork(orch, {
      selectTask: () => {},
      enterTask: async () => {},
      notifyError: () => {},
      notify: () => {},
      t: (key) => key,
    })
    return <text>probe</text>
  }
  await renderComponent(<Probe />)
  const result: QuickTaskResult = { prompt: "go on", vendor: "claude", baseRef, attachments: [], attempts: 1 }
  await act(async () => {
    hook?.onQuickFork("/repos/rove", result, source)
    await createCalled
  })
  return created
}

test("continuing from the source's own branch asks for a clone of its worktree", async () => {
  const created = await forkWith({ taskId: "PARENT", branch: "feat/x" }, "feat/x")
  expect(created.map((c) => c.forkFrom)).toEqual(["PARENT"])
})

test("a different base is a plain new task, not a clone", async () => {
  const created = await forkWith({ taskId: "PARENT", branch: "feat/x" }, "main")
  expect(created.map((c) => c.forkFrom)).toEqual([undefined])
})

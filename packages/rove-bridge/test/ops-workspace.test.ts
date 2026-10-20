import { describe, expect, test } from "bun:test"
import type { Args, BridgeApi } from "../src/ops/types.ts"
import { WORKSPACE_OPS } from "../src/ops/workspace.ts"

const TASK = "01M4756MVZKGC84R07M659BEJW"
const SPLIT = { activeLeafId: "leaf-2", root: { kind: "leaf", id: "leaf-1" } }

async function run(args: Args, reply: unknown = { leaf: "leaf-2", changed: true, split: SPLIT }) {
  const calls: Array<{ name: string; argv: readonly string[] }> = []
  const api: BridgeApi = {
    async verb(name, argv) {
      calls.push({ name, argv })
      return reply as never
    },
    async rpc() {
      throw new Error("tab.split only runs a verb")
    },
  }
  const spec = WORKSPACE_OPS["tab.split"]
  if (!spec) throw new Error("no op tab.split")
  const result = await spec.run(args, { api })
  return { result, calls }
}

describe("tab.split", () => {
  test("open defaults to the right and carries the pane's size when given", async () => {
    const { result, calls } = await run({
      taskId: TASK,
      tabId: "tab-1",
      action: "open",
      leafId: "leaf-1",
      cols: 120,
      rows: 30,
    })
    expect(calls).toEqual([
      {
        name: "tab-split",
        argv: [
          `--task-id=${TASK}`,
          "--tab=tab-1",
          "--action=open",
          "--leaf=leaf-1",
          "--direction=right",
          "--cols=120",
          "--rows=30",
        ],
      },
    ])
    expect(result).toEqual({ leaf: "leaf-2", changed: true, split: SPLIT })
  })

  test("down is a direction, anything else is refused", async () => {
    const { calls } = await run({ taskId: TASK, tabId: "tab-1", action: "open", direction: "down" })
    expect(calls[0]?.argv).toContain("--direction=down")
    await expect(run({ taskId: TASK, tabId: "tab-1", action: "open", direction: "diagonal" })).rejects.toThrow()
  })

  test("close and rename name the pane; without one they are refused", async () => {
    await expect(run({ taskId: TASK, tabId: "tab-1", action: "close" })).rejects.toThrow(/leafId is required/)
    await expect(run({ taskId: TASK, tabId: "tab-1", action: "rename" })).rejects.toThrow(/leafId is required/)
    const { calls } = await run({
      taskId: TASK,
      tabId: "tab-1",
      action: "rename",
      leafId: "leaf-2",
      title: "  build  ",
    })
    expect(calls[0]?.argv).toEqual([
      `--task-id=${TASK}`,
      "--tab=tab-1",
      "--action=rename",
      "--leaf=leaf-2",
      "--title=build",
    ])
  })

  test("an empty rename clears the name; a multi-line or control-character one is refused", async () => {
    const { calls } = await run({ taskId: TASK, tabId: "tab-1", action: "rename", leafId: "leaf-2", title: "" })
    expect(calls[0]?.argv).toContain("--title=")
    await expect(
      run({ taskId: TASK, tabId: "tab-1", action: "rename", leafId: "leaf-2", title: "a\nb" }),
    ).rejects.toThrow(/one line/)
    await expect(
      run({ taskId: TASK, tabId: "tab-1", action: "rename", leafId: "leaf-2", title: "x".repeat(81) }),
    ).rejects.toThrow(/one line/)
  })

  test("a pane id is leaf-N and nothing else, so it cannot smuggle a flag", async () => {
    for (const leafId of ["--leaf=leaf-1", "leaf-1 --x", "leaf-", "../leaf-1", 5]) {
      await expect(run({ taskId: TASK, tabId: "tab-1", action: "close", leafId })).rejects.toThrow(/not a pane id/)
    }
  })

  test("cols and rows go together", async () => {
    await expect(run({ taskId: TASK, tabId: "tab-1", action: "open", cols: 80 })).rejects.toThrow(/go together/)
  })

  test("reset needs a pane too", async () => {
    const { calls } = await run({ taskId: TASK, tabId: "tab-1", action: "reset", leafId: "leaf-1", cols: 80, rows: 24 })
    expect(calls[0]?.argv).toEqual([
      `--task-id=${TASK}`,
      "--tab=tab-1",
      "--action=reset",
      "--leaf=leaf-1",
      "--cols=80",
      "--rows=24",
    ])
  })
})

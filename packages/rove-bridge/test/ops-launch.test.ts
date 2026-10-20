import { afterEach, describe, expect, test } from "bun:test"
import { launchDeps, launchOps } from "../src/ops/launch.ts"
import { T, fakeApi } from "./task-ops-harness.ts"

const real = { ...launchDeps }
afterEach(() => Object.assign(launchDeps, real))

async function run(op: string, args: Record<string, unknown>, replies: Record<string, unknown> = {}) {
  const { api, calls } = fakeApi(replies)
  const spec = launchOps[op]
  if (!spec) throw new Error(`no op ${op}`)
  return { result: await spec.run(args, { api }), calls }
}

describe("file.openInEditor", () => {
  test("is one tab-new editor call carrying only the relative path", async () => {
    const { result, calls } = await run(
      "file.openInEditor",
      { taskId: T, path: "src/a.ts" },
      { "tab-new": { ok: true, tabId: "tab-4" } },
    )
    expect(result).toEqual({ tabId: "tab-4" })
    expect(calls).toEqual([{ verb: "tab-new", argv: [`--task-id=${T}`, "--kind=editor", "--file=src/a.ts"] }])
  })

  test("refuses an absolute path, a parent segment and an empty path before any verb runs", async () => {
    for (const path of ["/etc/passwd", "../x", "a/../../x", "", "a\0b"]) {
      const { api, calls } = fakeApi()
      await expect(launchOps["file.openInEditor"]?.run({ taskId: T, path }, { api })).rejects.toMatchObject({
        code: "BAD_ARGS",
      })
      expect(calls).toEqual([])
    }
  })
})

describe("plugin panes", () => {
  test("the list carries ids, titles and placements, never an argv", async () => {
    launchDeps.panes = () => [{ id: "p.git", title: "lazygit", placement: "split" }]
    const { result } = await run("plugin.panes", {})
    expect(result).toEqual({ panes: [{ id: "p.git", title: "lazygit", placement: "split" }] })
  })

  test("opening names the pane (and optionally the host tab); anything else is refused", async () => {
    const { result, calls } = await run(
      "plugin.paneOpen",
      { taskId: T, pane: "p.git", tabId: "tab-2" },
      { "tab-new": { ok: true, tabId: "tab-2", leaf: "leaf-2" } },
    )
    expect(result).toEqual({ tabId: "tab-2", leaf: "leaf-2" })
    expect(calls).toEqual([{ verb: "tab-new", argv: [`--task-id=${T}`, "--kind=pane", "--pane=p.git", "--tab=tab-2"] }])
    for (const args of [
      { taskId: T, pane: "--x" },
      { taskId: T, pane: "p git" },
      { taskId: T, pane: "p.git", tabId: "../1" },
    ]) {
      await expect(run("plugin.paneOpen", args)).rejects.toMatchObject({ code: "BAD_ARGS" })
    }
  })
})

describe("tab.openViewport", () => {
  test("opens a viewport tab onto the named task", async () => {
    const { result, calls } = await run(
      "tab.openViewport",
      { taskId: T, viewTaskId: "01OTHER" },
      { "tab-new": { ok: true, tabId: "tab-3" } },
    )
    expect(result).toEqual({ tabId: "tab-3" })
    expect(calls).toEqual([{ verb: "tab-new", argv: [`--task-id=${T}`, "--kind=viewport", "--view-task=01OTHER"] }])
    await expect(run("tab.openViewport", { taskId: T, viewTaskId: "--x" })).rejects.toMatchObject({ code: "BAD_ARGS" })
  })
})

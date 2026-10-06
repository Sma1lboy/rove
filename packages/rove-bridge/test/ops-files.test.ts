import { describe, expect, test } from "bun:test"
import type { DiffComment } from "@sma1lboy/rove/src/tui/ops/diff-comments.ts"
import { type NoteStore, createFilesOps } from "../src/ops/files.ts"
import type { BridgeApi, OpTable } from "../src/ops/types.ts"

type Call = { kind: "verb" | "rpc"; name: string; payload: unknown }

function fakeApi(
  handlers: Record<string, (payload: unknown) => unknown>,
  calls: Call[] = [],
): { api: BridgeApi; calls: Call[] } {
  const api: BridgeApi = {
    async verb<T>(name: string, argv: readonly string[]) {
      calls.push({ kind: "verb", name, payload: argv })
      const h = handlers[name]
      if (!h) throw new Error(`unexpected verb ${name}`)
      return (await h(argv)) as T
    },
    async rpc<T>(name: string, payload?: unknown) {
      calls.push({ kind: "rpc", name, payload })
      const h = handlers[name]
      if (!h) throw new Error(`unexpected rpc ${name}`)
      return (await h(payload)) as T
    },
  }
  return { api, calls }
}

function memoryNotes(): NoteStore & { data: Map<string, readonly DiffComment[]> } {
  const data = new Map<string, readonly DiffComment[]>()
  return {
    data,
    read: (id) => data.get(id) ?? [],
    update(id, mutate) {
      data.set(id, mutate(data.get(id) ?? []))
    },
  }
}

function setup(listed: string[] = ["a.ts"]) {
  const notes = memoryNotes()
  let n = 0
  const ops: OpTable = createFilesOps({
    listFiles: async () => listed,
    notes,
    now: () => 1000,
    newId: () => `n${++n}`,
  })
  const run = (op: string, args: Record<string, unknown>, api: BridgeApi) => {
    const spec = ops[op]
    if (!spec) throw new Error(`no op ${op}`)
    return spec.run(args, { api })
  }
  return { notes, ops, run }
}

const task = { "get-task": () => ({ task: { worktreePath: "/wt/t1" } }) }

describe("files.list", () => {
  test("lists the task's worktree and flags truncation", async () => {
    const { run } = setup(["a", "b"])
    const { api, calls } = fakeApi(task)
    expect(await run("files.list", { taskId: "t1" }, api)).toEqual({ files: ["a", "b"], truncated: false })
    expect(calls[0]).toEqual({ kind: "verb", name: "get-task", payload: ["--task-id=t1"] })
  })

  test("a task without a worktree is refused and a flag-like id never reaches the verb", async () => {
    const { run } = setup()
    const { api, calls } = fakeApi({ "get-task": () => ({ task: { worktreePath: null } }) })
    await expect(run("files.list", { taskId: "t1" }, api)).rejects.toThrow("no worktree")
    await expect(run("files.list", { taskId: "--force" }, api)).rejects.toThrow("not a task id")
    expect(calls).toHaveLength(1)
  })
})

describe("review notes", () => {
  test("add stores a note; startLine equal to line is a single-line note; bad input is refused", async () => {
    const { run, notes } = setup()
    const { api } = fakeApi({})
    await run("review.add", { taskId: "t1", filePath: "src/a.ts", line: 4, startLine: 4, body: "why?" }, api)
    await run("review.add", { taskId: "t1", filePath: "src/a.ts", line: 9, startLine: 7, body: "range" }, api)
    expect(notes.data.get("t1")).toEqual([
      { id: "n1", filePath: "src/a.ts", line: 4, body: "why?", createdAt: 1000 },
      { id: "n2", filePath: "src/a.ts", startLine: 7, line: 9, body: "range", createdAt: 1000 },
    ])
    for (const bad of [
      { filePath: "/etc/passwd", line: 1, body: "x" },
      { filePath: "../x", line: 1, body: "x" },
      { filePath: "a", line: 0, body: "x" },
      { filePath: "a", line: 3, startLine: 5, body: "x" },
      { filePath: "a", line: 3, body: "  " },
    ]) {
      await expect(run("review.add", { taskId: "t1", ...bad }, api)).rejects.toThrow()
    }
    expect(notes.data.get("t1")).toHaveLength(2)
  })

  test("remove is destructive and drops exactly one note", async () => {
    const { run, notes, ops } = setup()
    const { api } = fakeApi({})
    expect(ops["review.remove"]?.destructive).toBe(true)
    await run("review.add", { taskId: "t1", filePath: "a", line: 1, body: "one" }, api)
    await run("review.add", { taskId: "t1", filePath: "a", line: 2, body: "two" }, api)
    expect(await run("review.remove", { taskId: "t1", id: "n1" }, api)).toEqual({ removed: true })
    expect(await run("review.remove", { taskId: "t1", id: "nope" }, api)).toEqual({ removed: false })
    expect(notes.data.get("t1")?.map((c) => c.id)).toEqual(["n2"])
  })

  test("send pastes every unsent note as one plain prompt, then marks only those sent", async () => {
    const { run, notes } = setup()
    const { api, calls } = fakeApi({ ...task, send: () => ({ delivered: true }) })
    await run("review.add", { taskId: "t1", filePath: "a.ts", line: 2, body: 'say "hi"' }, api)
    await run("review.add", { taskId: "t1", filePath: "a.ts", startLine: 3, line: 5, body: "b" }, api)
    expect(await run("review.send", { taskId: "t1", tabId: "tab-2" }, api)).toEqual({ sent: 2, delivered: true })
    const sendCall = calls.find((c) => c.name === "send")
    expect(sendCall?.payload).toEqual([
      "--task-id=t1",
      "--plain",
      `--prompt=${[
        "File: a.ts",
        "Line: 2",
        "Note: this path is no longer in the branch — it was renamed or deleted after the note was written.",
        'User comment: "say \\"hi\\""',
        "",
        "File: a.ts",
        "Lines: 3-5",
        "Note: this path is no longer in the branch — it was renamed or deleted after the note was written.",
        'User comment: "b"',
      ].join("\n")}`,
      "--tab=tab-2",
    ])
    expect(notes.data.get("t1")?.every((c) => c.sentAt === 1000)).toBe(true)
    // Nothing left: a second send is a no-op that never touches the engine.
    const before = calls.length
    expect(await run("review.send", { taskId: "t1" }, api)).toEqual({ sent: 0, delivered: true })
    expect(calls).toHaveLength(before)
  })

  test("a refused, unconfirmed or dead-target send leaves every note unsent", async () => {
    const { run, notes } = setup()
    await run("review.add", { taskId: "t1", filePath: "a", line: 1, body: "x" }, fakeApi({}).api)
    const refused = fakeApi({
      ...task,
      send: () => {
        throw new Error("NOT_DELIVERED")
      },
    })
    await expect(run("review.send", { taskId: "t1" }, refused.api)).rejects.toThrow("NOT_DELIVERED")
    const dead = fakeApi({ ...task, send: () => ({ delivered: true, targetState: "dead", targetDetail: "gone" }) })
    expect(await run("review.send", { taskId: "t1" }, dead.api)).toEqual({ sent: 0, delivered: false, reason: "gone" })
    const unconfirmed = fakeApi({ ...task, send: () => ({}) })
    expect(await run("review.send", { taskId: "t1" }, unconfirmed.api)).toMatchObject({ delivered: false })
    expect(notes.data.get("t1")?.[0]?.sentAt).toBeUndefined()
    await expect(run("review.send", { taskId: "t1", tabId: "tab-1; x" }, refused.api)).rejects.toThrow("tab id")
  })

  test("a note added while a send is in flight stays unsent", async () => {
    const { run, notes } = setup()
    await run("review.add", { taskId: "t1", filePath: "a", line: 1, body: "first" }, fakeApi({}).api)
    const racing = fakeApi({
      ...task,
      send: () => {
        notes.update("t1", (cur) => [...cur, { id: "late", filePath: "a", line: 2, body: "late", createdAt: 5 }])
        return { delivered: true }
      },
    })
    await run("review.send", { taskId: "t1" }, racing.api)
    expect(notes.data.get("t1")?.map((c) => [c.id, c.sentAt])).toEqual([
      ["n1", 1000],
      ["late", undefined],
    ])
  })
})

describe("worktrees", () => {
  const wt = (path: string) => ({ path, branch: "b", dirty: false })
  const list = { projects: [{ repo: "/r", worktrees: [wt("/wt/t1"), wt("/wt/adhoc")] }] }

  test("list joins the tracked task and kind by path and asks the daemon with network", async () => {
    const { run } = setup()
    const { api, calls } = fakeApi({
      "worktree.list": () => list,
      "task.list": () => ({ tasks: [{ id: "t1", kind: "task", worktreePath: "/private/wt/t1" }] }),
    })
    const res = (await run("worktrees.list", {}, api)) as { projects: { worktrees: Record<string, unknown>[] }[] }
    expect(res.projects[0]?.worktrees[0]).toMatchObject({ path: "/wt/t1", taskId: "t1", taskKind: "task" })
    expect(res.projects[0]?.worktrees[1]?.taskId).toBeUndefined()
    expect(calls.find((c) => c.name === "worktree.list")?.payload).toEqual({ network: true })
    await expect(run("worktrees.list", { network: "yes" }, api)).rejects.toThrow("boolean")
  })

  test("remove is destructive, needs an explicit force, and only touches listed worktrees", async () => {
    const { run, ops } = setup()
    expect(ops["worktrees.remove"]?.destructive).toBe(true)
    const { api, calls } = fakeApi({ "worktree.list": () => list, "worktree.remove": () => ({ removed: true }) })
    await expect(run("worktrees.remove", { path: "/wt/t1" }, api)).rejects.toThrow("force")
    await expect(run("worktrees.remove", { path: "relative", force: false }, api)).rejects.toThrow("absolute")
    await expect(run("worktrees.remove", { path: "/etc", force: true }, api)).rejects.toThrow("not a listed worktree")
    expect(calls.some((c) => c.name === "worktree.remove")).toBe(false)
    expect(await run("worktrees.remove", { path: "/wt/t1", force: false }, api)).toEqual({ removed: true })
    expect(calls.at(-1)).toEqual({ kind: "rpc", name: "worktree.remove", payload: { path: "/wt/t1", force: false } })
  })

  test("a dirty refusal surfaces with a stable code and git's own text", async () => {
    const { run } = setup()
    const { api } = fakeApi({
      "worktree.list": () => list,
      "worktree.remove": () => {
        throw Object.assign(new Error("DIRTY_WORKTREE: 2 uncommitted files"), { code: "RPC_ERROR" })
      },
    })
    const wrapped: BridgeApi = {
      verb: api.verb,
      rpc: async (name, payload) => {
        try {
          return await api.rpc(name, payload)
        } catch (e) {
          const { BridgeError } = await import("../src/protocol.ts")
          throw new BridgeError("RPC_ERROR", (e as Error).message)
        }
      },
    }
    await expect(run("worktrees.remove", { path: "/wt/t1", force: false }, wrapped)).rejects.toMatchObject({
      code: "DIRTY_WORKTREE",
      message: "2 uncommitted files",
    })
  })
})

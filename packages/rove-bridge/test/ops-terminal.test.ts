import { describe, expect, test } from "bun:test"
import { parseFlags } from "@sma1lboy/rove/src/cli/api/flags.ts"
import type { TerminalTab } from "@sma1lboy/rove/src/tui/workspace/terminal-tabs-core.ts"
import { MAX_ATTACHMENT_BYTES, type TerminalOpDeps, matchesMagic, terminalOps } from "../src/ops/terminal.ts"
import type { BridgeApi } from "../src/ops/types.ts"
import { attentionRows } from "../src/rove-ops.ts"

type Call = { kind: "verb" | "rpc"; name: string; argv?: readonly string[]; payload?: unknown }

/** A BridgeApi double that records every call and answers from `replies`. */
function fakeApi(replies: Record<string, unknown> = {}): { api: BridgeApi; calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    api: {
      async verb<T>(name: string, argv: readonly string[]): Promise<T> {
        calls.push({ kind: "verb", name, argv })
        return (replies[name] ?? {}) as T
      },
      async rpc<T>(name: string, payload?: unknown): Promise<T> {
        calls.push({ kind: "rpc", name, payload })
        return (replies[name] ?? {}) as T
      },
    },
  }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])
const written: Array<{ path: string; bytes: Uint8Array }> = []

function deps(over: Partial<TerminalOpDeps> = {}): TerminalOpDeps {
  return {
    attachmentsDir: () => "/home/.rove/attachments",
    now: () => new Date("2026-10-05T12:00:00Z"),
    nonce: () => "deadbeef",
    writeFile: (path, bytes) => void written.push({ path, bytes }),
    readTab: () => undefined,
    planHandoff: async () => ({ kind: "no-session" }),
    prPrompt: async () => "make a PR",
    ...over,
  }
}

const TASK = "01M4756MVZKGC84R07M659BEJW"

async function run(op: string, args: Record<string, unknown>, d: Partial<TerminalOpDeps> = {}, replies = {}) {
  const { api, calls } = fakeApi(replies)
  const spec = terminalOps(deps(d))[op]
  if (!spec) throw new Error(`no op ${op}`)
  const result = await spec.run(args, { api })
  return { result, calls }
}

describe("tab.states", () => {
  test("returns only the asked task's per-tab state and drops malformed entries", async () => {
    const { result, calls } = await run(
      "tab.states",
      { taskId: TASK },
      {},
      {
        "debug.inspect": {
          activity: {
            tabs: {
              [TASK]: { "tab-1": { state: "running", at: 5 }, "tab-2": { state: 7 } },
              other: { "tab-1": { state: "dead", at: 1 } },
            },
          },
        },
      },
    )
    expect(result).toEqual({ tabs: { "tab-1": { state: "running", at: 5 } } })
    expect(calls).toEqual([{ kind: "rpc", name: "debug.inspect", payload: undefined }])
  })

  test("a daemon with no activity answers an empty map", async () => {
    expect((await run("tab.states", { taskId: TASK }, {}, { "debug.inspect": {} })).result).toEqual({ tabs: {} })
  })
})

describe("tab.rename", () => {
  test("builds exactly `update --tab` and keeps a flag-looking title a value", async () => {
    const { calls } = await run("tab.rename", { taskId: TASK, tabId: "tab-2", title: "--force" })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.name).toBe("update")
    const { flags } = parseFlags([...(call?.argv ?? [])])
    expect(flags.get("task-id")).toBe(TASK)
    expect(flags.get("tab")).toBe("tab-2")
    expect(flags.get("title")).toBe("--force")
    expect(flags.has("force")).toBe(false)
  })

  test("refuses a bad id, an empty or multi-line title, and an over-long one", async () => {
    for (const args of [
      { taskId: "--x", tabId: "tab-1", title: "a" },
      { taskId: TASK, tabId: "tab-x", title: "a" },
      { taskId: TASK, tabId: "tab-1", title: "  " },
      { taskId: TASK, tabId: "tab-1", title: "a\nb" },
      { taskId: TASK, tabId: "tab-1", title: "x".repeat(81) },
    ]) {
      const { calls } = fakeApi()
      await expect(run("tab.rename", args)).rejects.toThrow()
      expect(calls).toHaveLength(0)
    }
  })
})

describe("tab.interrupt", () => {
  test("targets the task, or one exact tab when given", async () => {
    expect((await run("tab.interrupt", { taskId: TASK })).calls).toEqual([
      { kind: "verb", name: "interrupt", argv: [`--task-id=${TASK}`] },
    ])
    expect((await run("tab.interrupt", { taskId: TASK, tabId: "tab-3" })).calls[0]?.argv).toEqual([
      `--task-id=${TASK}`,
      "--tab=tab-3",
    ])
    await expect(run("tab.interrupt", { taskId: TASK, tabId: "nope" })).rejects.toThrow("not a tab id")
  })
})

describe("tab.forkTask", () => {
  const base = { repo: "/repos/api", baseBranch: "feat/x", prompt: "try it" }

  test("one `add` branched from the task's branch; attempts add --count", async () => {
    const single = await run("tab.forkTask", { ...base, engine: "claude" }, {}, { add: { taskId: "T9" } })
    expect(single.result).toEqual({ taskIds: ["T9"] })
    expect(single.calls).toEqual([
      {
        kind: "verb",
        name: "add",
        argv: ["--repo=/repos/api", "--base-branch=feat/x", "--prompt=try it", "--command=claude"],
      },
    ])
    const fan = await run(
      "tab.forkTask",
      { ...base, count: 3 },
      {},
      { add: { tasks: [{ taskId: "A" }, { taskId: "B" }, { taskId: "C" }] } },
    )
    expect(fan.result).toEqual({ taskIds: ["A", "B", "C"] })
    expect(fan.calls[0]?.argv).toContain("--count=3")
  })

  test("refuses option-like or malformed branches, repos and engines; caps attempts at 5", async () => {
    for (const bad of [
      { baseBranch: "--force" },
      { baseBranch: "a..b" },
      { baseBranch: "a b" },
      { baseBranch: "x.lock" },
      { baseBranch: "" },
      { repo: "relative/path" },
      { engine: "claude --dangerously-skip-permissions" },
      { count: 6 },
      { count: 0 },
      { prompt: "   " },
    ]) {
      await expect(run("tab.forkTask", { ...base, ...bad }, {}, { add: { taskId: "T" } })).rejects.toThrow()
    }
  })

  test("a reply naming no task is an error, never a silent success", async () => {
    await expect(run("tab.forkTask", base, {}, { add: {} })).rejects.toThrow("no task was created")
  })
})

describe("tab.handoff", () => {
  const reply = { "get-task": { task: { id: TASK, worktreePath: "/wt", vendor: "claude" } } }

  test("plans from the persisted tab, in the task's worktree, and returns the brief", async () => {
    const tab = { kind: "engine", id: "tab-2", sessionId: "s1", vendor: "codex" } as unknown as TerminalTab
    let seen: unknown[] = []
    const { result } = await run(
      "tab.handoff",
      { taskId: TASK, tabId: "tab-2" },
      {
        readTab: () => tab,
        planHandoff: async (active, source, worktree) => {
          seen = [active, source, worktree]
          return { kind: "handoff", prompt: "read /t.jsonl" }
        },
      },
      reply,
    )
    expect(result).toEqual({ kind: "handoff", prompt: "read /t.jsonl" })
    expect(seen).toEqual([tab, "codex", "/wt"])
  })

  test("a refusal carries its reason; a task without a worktree is refused before planning", async () => {
    const { result } = await run(
      "tab.handoff",
      { taskId: TASK, tabId: "tab-1" },
      { planHandoff: async () => ({ kind: "no-transcript", engine: "Kimi" }) },
      reply,
    )
    expect(result).toEqual({ kind: "no-transcript", engine: "Kimi" })
    await expect(
      run("tab.handoff", { taskId: TASK, tabId: "tab-1" }, {}, { "get-task": { task: { id: TASK } } }),
    ).rejects.toThrow("no worktree")
  })
})

describe("tab.requestPR", () => {
  test("sends the built PR prompt verbatim with --plain, to the exact tab when named", async () => {
    const { calls } = await run(
      "tab.requestPR",
      { taskId: TASK, tabId: "tab-2" },
      { prPrompt: async (wt) => `PR from ${wt}` },
      { "get-task": { task: { id: TASK, worktreePath: "/wt" } } },
    )
    expect(calls.map((c) => c.name)).toEqual(["get-task", "send"])
    expect(calls[1]?.argv).toEqual([`--task-id=${TASK}`, "--plain", "--prompt=PR from /wt", "--tab=tab-2"])
  })
})

describe("attachment.put", () => {
  const put = (mime: string, bytes: Uint8Array) =>
    run("attachment.put", { mime, data: Buffer.from(bytes).toString("base64") })

  test("writes a generated name under the attachments dir and returns the absolute path", async () => {
    written.length = 0
    const { result } = await put("image/png", PNG)
    expect(result).toEqual({
      path: "/home/.rove/attachments/attach-20261005-deadbeef.png",
      kind: "image",
      bytes: PNG.length,
    })
    expect(written[0]?.path).toBe("/home/.rove/attachments/attach-20261005-deadbeef.png")
    expect(Buffer.from(written[0]?.bytes ?? []).equals(PNG)).toBe(true)
  })

  test("types outside png/jpeg/gif/webp/pdf are refused, and the bytes must match the declared type", async () => {
    written.length = 0
    await expect(put("image/svg+xml", PNG)).rejects.toThrow("mime must be one of")
    await expect(put("application/pdf", PNG)).rejects.toThrow("not a pdf")
    await expect(put("image/png", Buffer.from("not an image"))).rejects.toThrow("not a png")
    // RIFF alone is not WebP.
    const riff = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")])
    await expect(put("image/webp", riff)).rejects.toThrow("not a webp")
    expect(written).toHaveLength(0)
  })

  test("accepts a real PDF and WebP header", async () => {
    expect(matchesMagic("application/pdf", Buffer.from("%PDF-1.7 body"))).toBe(true)
    expect(matchesMagic("image/webp", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe(
      true,
    )
  })

  test("over the size cap is refused with TOO_LARGE before anything is written", async () => {
    written.length = 0
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_ATTACHMENT_BYTES)])
    await expect(put("image/png", big)).rejects.toMatchObject({ code: "TOO_LARGE" })
    expect(written).toHaveLength(0)
  })
})

describe("attention rows", () => {
  const task = (id: string, resumeAt?: string) => ({ id, ...(resumeAt ? { quotaResume: { resumeAt } } : {}) }) as never

  test("a rate-limited item carries its task's resume time; other states and routines do not", () => {
    const base = { tabId: "tab-1", unread: true, at: 1 }
    const rows = attentionRows(
      [
        { ...base, taskId: "a", state: "rate_limited" },
        { ...base, taskId: "a", state: "turn_complete" },
        {
          ...base,
          taskId: null,
          tabId: null,
          state: "routine_failed",
          detail: { routine: { automationId: "r", name: "nightly", status: "x" } },
        },
      ] as never,
      [task("a", "2026-10-05T15:14:00Z")],
    )
    expect(rows[0]).toMatchObject({ resumeAt: "2026-10-05T15:14:00Z" })
    expect(rows[1]).not.toHaveProperty("resumeAt")
    expect(rows[2]).toMatchObject({ label: "nightly" })
    expect(rows[2]).not.toHaveProperty("resumeAt")
  })

  test("without a quotaResume the row keeps the old shape", () => {
    const [row] = attentionRows([{ taskId: "a", tabId: null, state: "rate_limited", unread: true, at: 2 }] as never, [
      task("a"),
    ])
    expect(Object.keys(row ?? {}).sort()).toEqual(["at", "state", "tabId", "taskId", "unread"])
  })
})

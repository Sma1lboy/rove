/**
 * `send --tab new --handoff-from tab-N`: the agent twin of "Continue in another
 * engine…". The first prompt of the new conversation carries the old one's
 * context, and the new engine starts in the SAME directory.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { encodeCwd } from "@/engine/claude-code-local/history"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const WORKTREE = "/repo/wt-handoff"
const SESSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

let claudeDir: string
let prevConfigDir: string | undefined
let prevHome: string | undefined
let transcript: string

const line = (role: "user" | "assistant", text: string, n: number): string =>
  JSON.stringify({
    type: role,
    uuid: `u-${n}`,
    sessionId: SESSION,
    timestamp: `2026-11-05T00:00:0${n}.000Z`,
    message: { role, content: role === "user" ? text : [{ type: "text", text }] },
  })

beforeAll(() => {
  prevHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-handoff-home-"))
  claudeDir = mkdtempSync(join(tmpdir(), "rove-handoff-"))
  const projectDir = join(claudeDir, "projects", encodeCwd(WORKTREE))
  mkdirSync(projectDir, { recursive: true })
  transcript = join(projectDir, `${SESSION}.jsonl`)
  writeFileSync(
    transcript,
    [
      line("user", "add a --json flag to the list command", 1),
      line("assistant", "Added it in cli.ts", 2),
      line("user", "now document the flag in docs/API.md", 3),
      line("assistant", "Working on it, but I hit my usage limit", 4),
    ].join("\n"),
  )
  prevConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = claudeDir
})

afterAll(() => {
  process.env.CLAUDE_CONFIG_DIR = prevConfigDir ?? ""
  rmSync(claudeDir, { recursive: true, force: true })
  rmSync(process.env.ROVE_HOME_DIR ?? "", { recursive: true, force: true })
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = prevHome
})

function fixture(
  tab: Record<string, unknown> = { kind: "engine", id: "tab-1", vendor: "claude", sessionId: SESSION },
  worktree = WORKTREE,
) {
  const child = taskFixture({
    id: "kid",
    vendor: "codex",
    command: "codex",
    parentTaskId: "abc",
    sharesWorkspaceOf: "abc",
    worktreePath: WORKTREE,
  })
  return new FakeClient({
    "task.get": () => ({ task: taskFixture({ id: "abc", title: "Document the json flag", worktreePath: worktree }) }),
    "tabs.get": () => ({ state: { tabs: [{ spawned: true, ...tab }], activeId: "tab-1" }, rev: 1 }),
    "task.spawn": () => ({ taskId: "kid", task: child, parentDirty: false, sharedLinks: [] }),
    "task.setPrompt": () => ({}),
    "tabs.apply": () => ({ state: { tabs: [], nextOrdinal: 2 }, rev: 2, opened: [] }),
  })
}

describe("send --handoff-from", () => {
  it("starts the other engine in the same directory, its first prompt carrying the old conversation", async () => {
    const { calls, deliver } = recordingDelivery()
    const result = await invokeVerb(
      "send",
      ["--task-id", "abc", "--tab", "new", "--command", "codex", "--handoff-from", "tab-1", "--plain"],
      { client: fixture(), runtime: stubRuntime({ deliverPrompt: deliver }) },
    )
    expect(result).toMatchObject({ ok: true, taskId: "abc", childTaskId: "kid", delivered: true })
    const { prompt, target } = calls[0]
    expect(target).toMatchObject({ worktreePath: WORKTREE, command: "codex" })
    expect(prompt).toContain(`Continue "Document the json flag" from a previous Claude`)
    expect(prompt).toContain(transcript)
    expect(prompt).toContain("<last-request>\nnow document the flag in docs/API.md\n</last-request>")
    expect(prompt).toContain("[assistant] Added it in cli.ts")
  })

  it("adds --prompt after the brief", async () => {
    const { calls, deliver } = recordingDelivery()
    await invokeVerb(
      "send",
      ["--task-id", "abc", "--tab", "new", "--handoff-from", "tab-1", "--plain", "--prompt", "finish the docs only"],
      { client: fixture(), runtime: stubRuntime({ deliverPrompt: deliver }) },
    )
    const { prompt } = calls[0]
    expect(prompt.endsWith("\n\nfinish the docs only")).toBe(true)
  })

  describe("--replace", () => {
    const withTabs = (rows: Array<Record<string, unknown>>) =>
      stubRuntime({ taskTabs: async () => ({ tabs: rows as never, running: false }) })
    const deadTab = { id: "tab-1", kind: "engine", alive: true, engineAlive: false }

    it("puts the new engine in the dead tab's own slot: same task, same tab, no child", async () => {
      const client = fixture()
      const revived: string[] = []
      const { calls, deliver } = recordingDelivery({ session: "abc::tab-1" })
      const result = await invokeVerb(
        "send",
        ["--task-id", "abc", "--tab", "new", "--command", "codex", "--handoff-from", "tab-1", "--replace", "--plain"],
        {
          client,
          runtime: {
            ...withTabs([deadTab]),
            deliverPrompt: deliver,
            reviveTab: async (_c, _t, tabId, _w, opts) => {
              revived.push(`${tabId}:${opts?.replaceExited}:${opts?.awaitEngine}`)
              return { revived: true, resumed: false }
            },
          },
        },
      )
      expect(result).toMatchObject({ ok: true, taskId: "abc", replacedTab: "tab-1", delivered: true })
      expect(result).not.toHaveProperty("childTaskId")
      expect(client.requestNames).not.toContain("task.spawn")
      // The row is repointed at the new engine and loses the old conversation's identity.
      const patch = client.requests.find((r) => r.name === "tabs.apply")?.payload as {
        ops: Array<{ op: string; id: string; set?: Record<string, unknown>; unset?: string[] }>
      }
      expect(patch.ops[0]).toMatchObject({ op: "patch", id: "tab-1", set: { vendor: "codex" } })
      expect(patch.ops[0]?.unset).toEqual(expect.arrayContaining(["sessionId", "spawned", "engineCommand"]))
      // The leftover shell is replaced, then the brief is pasted into THAT tab.
      expect(revived).toEqual(["tab-1:true:true"])
      expect(calls[0]?.target).toMatchObject({ id: "abc", tab: "tab-1" })
      expect(calls[0]?.prompt).toContain(transcript)
    })

    it("keeps a live source on the child-task path: refuses --replace", async () => {
      const client = fixture()
      await expectApiError(
        () =>
          invokeVerb("send", ["--task-id", "abc", "--tab", "new", "--handoff-from", "tab-1", "--replace", "--plain"], {
            client,
            runtime: {
              ...withTabs([{ id: "tab-1", kind: "engine", alive: true, engineAlive: true }]),
              deliverPrompt: recordingDelivery().deliver,
            },
          }),
        "TAB_ALIVE",
      )
      expect(client.requestNames).not.toContain("tabs.apply")
      expect(client.requestNames).not.toContain("task.spawn")
    })

    it("needs --handoff-from", async () => {
      await expectApiError(
        () =>
          invokeVerb("send", ["--task-id", "abc", "--tab", "new", "--replace", "--plain", "--prompt", "x"], {
            client: fixture(),
            runtime: stubRuntime({ deliverPrompt: recordingDelivery().deliver }),
          }),
        "BAD_FLAG",
      )
    })
  })

  it("refuses to run without --tab new, on a shell tab and on a tab with no conversation", async () => {
    const run = (flags: string[], client = fixture()) =>
      invokeVerb("send", ["--task-id", "abc", "--handoff-from", "tab-1", "--plain", ...flags], {
        client,
        runtime: stubRuntime({ deliverPrompt: recordingDelivery().deliver }),
      })
    await expectApiError(() => run(["--prompt", "x"]), "BAD_FLAG")
    await expectApiError(
      () => run(["--tab", "new"], fixture({ kind: "command", id: "tab-1", command: ["zsh"] })),
      "BAD_FLAG",
    )
    // An unpinned tab falls back to the newest session of ITS directory; this one has none.
    await expectApiError(
      () => run(["--tab", "new"], fixture({ kind: "engine", id: "tab-1", vendor: "claude" }, "/repo/no-sessions")),
      "NO_CONVERSATION",
    )
  })
})

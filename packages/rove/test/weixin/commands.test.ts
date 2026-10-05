import { describe, expect, it, vi } from "vitest"
import type { ContextPayload } from "../../src/cli/api/context-view.ts"
import { ApiError } from "../../src/cli/api/types.ts"
import { HELP_TEXT, type RoveOps, handleCommand } from "../../src/weixin/commands.ts"
import { BUBBLE_CHARS, MAX_BUBBLES, toBubbles } from "../../src/weixin/format.ts"

type Row = ContextPayload["tasks"][number]

function row(id: string, group: Row["group"], extra: Partial<Row> = {}): Row {
  return { taskId: id, title: `task ${id.slice(-3)}`, branch: "b", group, rank: 0, activity: null, ...extra }
}

function payload(tasks: Row[]): ContextPayload {
  return { repo: "*", at: "", tasks, attention: [], notes: [] }
}

function fakeOps(overrides: Partial<RoveOps> = {}): RoveOps {
  return {
    status: vi.fn(async () => payload([])),
    tasks: async () => [
      { id: "01AAAAAAAAAAAAAAAAAAABC123", title: "Fix login", repo: "/r/app" },
      { id: "01AAAAAAAAAAAAAAAAAAXBC123", title: "Add retry", repo: "/r/app" },
      { id: "01AAAAAAAAAAAAAAAAAAQQQ999", title: "Docs", repo: "/r/site" },
    ],
    repos: async () => ["/r/app", "/r/site", "/other/app2"],
    send: vi.fn(async () => ({ tab: "tab-1", started: false })),
    add: vi.fn(async () => ({ taskId: "01NEWNEWNEWNEWNEWNEWNEW777" })),
    ...overrides,
  }
}

describe("status", () => {
  it("leads with what needs a person, then lists those rows by short id", async () => {
    const ops = fakeOps({
      status: async () =>
        payload([
          row("01XXXXXXXXXXXXXXXXXXAAA111", "waiting-on-you", {
            activity: { state: "permission_needed", forMs: 1 },
          }),
          row("01XXXXXXXXXXXXXXXXXXBBB222", "landing", { pr: 42, checkState: "passing" }),
          row("01XXXXXXXXXXXXXXXXXXCCC333", "working"),
          row("01XXXXXXXXXXXXXXXXXXDDD444", "idle"),
        ]),
    })
    const reply = await handleCommand("status", ops)
    const lines = reply.split("\n")
    expect(lines[0]).toBe("1 need you · 1 ready to merge · 1 running · 1 quiet")
    expect(reply).toContain("• AAA111 task 111 — permission needed")
    expect(reply).toContain("• BBB222 task 222 — PR#42 · CI passing")
    expect(reply).not.toContain("DDD444")
  })

  it("says plainly when nothing needs you", async () => {
    const ops = fakeOps({ status: async () => payload([row("01XXXXXXXXXXXXXXXXXXCCC333", "working")]) })
    expect((await handleCommand("s", ops)).split("\n")[0]).toBe("Nothing needs you. 1 running")
  })

  it("scopes to a repo named by its directory, and lists known repos for a typo", async () => {
    const ops = fakeOps()
    await handleCommand("status site", ops)
    expect(ops.status).toHaveBeenCalledWith("/r/site")
    expect(await handleCommand("status nope", ops)).toBe('No repo "nope". Known: app, app2, site')
  })
})

describe("send", () => {
  it("resolves the short id and delivers the rest of the message verbatim", async () => {
    const ops = fakeOps()
    const reply = await handleCommand("send abc123 run the tests\nthen push", ops)
    expect(ops.send).toHaveBeenCalledWith("01AAAAAAAAAAAAAAAAAAABC123", undefined, "run the tests\nthen push")
    expect(reply).toBe("Sent to ABC123 Fix login (tab-1).")
  })

  it("takes an explicit tab only in the tab-N position", async () => {
    const ops = fakeOps()
    await handleCommand("send ABC123 tab-3 hi", ops)
    expect(ops.send).toHaveBeenLastCalledWith("01AAAAAAAAAAAAAAAAAAABC123", "tab-3", "hi")
    await handleCommand("send ABC123 tabs are fine", ops)
    expect(ops.send).toHaveBeenLastCalledWith("01AAAAAAAAAAAAAAAAAAABC123", undefined, "tabs are fine")
  })

  it("refuses ambiguous, unknown and too-short ids without sending", async () => {
    const ops = fakeOps()
    expect(await handleCommand("send 123 hi", ops)).toContain("too short")
    expect(await handleCommand("send bc123 hi", ops)).toMatch(/^"bc123" matches 2 tasks:/)
    expect(await handleCommand("send 000000 hi", ops)).toBe('No task ending in "000000". Send "status" for the list.')
    expect(await handleCommand("send abc123", ops)).toBe("Usage: send <id> [tab-N] <text>")
    expect(ops.send).not.toHaveBeenCalled()
  })

  it("turns a refused verb into a reply instead of throwing", async () => {
    const ops = fakeOps({
      send: async () => {
        throw new ApiError("prompt was not confirmed", "NOT_DELIVERED")
      },
    })
    expect(await handleCommand("send abc123 hi", ops)).toBe("Failed (NOT_DELIVERED): prompt was not confirmed")
  })
})

describe("add", () => {
  it("starts a task in the named repo with the whole prompt", async () => {
    const ops = fakeOps()
    const reply = await handleCommand("add app fix the flaky login test", ops)
    expect(ops.add).toHaveBeenCalledWith("/r/app", "fix the flaky login test")
    expect(reply).toBe("Started task NEW777 in app. I'll message you when it needs you.")
  })

  it("needs both a repo and a prompt", async () => {
    expect(await handleCommand("add app", fakeOps())).toBe("Usage: add <repo> <prompt>")
  })
})

it("answers help and unknown words with the command list", async () => {
  expect(await handleCommand("帮助", fakeOps())).toBe(HELP_TEXT)
  expect(await handleCommand("deploy prod", fakeOps())).toBe(`Unknown command "deploy".\n${HELP_TEXT}`)
})

describe("toBubbles", () => {
  it("keeps short text whole and preserves blank lines", () => {
    expect(toBubbles("a\n\nb")).toEqual(["a\n\nb"])
  })

  it("splits on line boundaries and cuts past the bubble cap with a count", () => {
    const line = "x".repeat(1000)
    const bubbles = toBubbles(Array.from({ length: 8 }, () => line).join("\n"))
    expect(bubbles).toHaveLength(MAX_BUBBLES)
    expect(bubbles.every((b) => b.length <= BUBBLE_CHARS)).toBe(true)
    expect(bubbles[MAX_BUBBLES - 1]).toMatch(/…\(cut, 5 more lines\)$/)
  })

  it("hard-wraps a single line longer than a bubble", () => {
    expect(toBubbles("y".repeat(BUBBLE_CHARS + 5)).map((b) => b.length)).toEqual([BUBBLE_CHARS, 5])
  })
})

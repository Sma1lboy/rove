import { describe, expect, it, mock } from "bun:test"
import type { ContextPayload } from "@sma1lboy/rove/src/cli/api/context-view.ts"
import { ApiError } from "@sma1lboy/rove/src/cli/api/types.ts"
import { HELP_TEXT, type RoveOps, agentPrompt, handleCommand, handleInbound } from "../src/commands.ts"
import { BUBBLE_CHARS, MAX_BUBBLES, toBubbles } from "../src/format.ts"

type Row = ContextPayload["tasks"][number]

function row(id: string, group: Row["group"], extra: Partial<Row> = {}): Row {
  return { taskId: id, title: `task ${id.slice(-3)}`, branch: "b", group, rank: 0, activity: null, ...extra }
}

function payload(tasks: Row[]): ContextPayload {
  return { repo: "*", at: "", tasks, attention: [], gates: [], notes: [] }
}

function fakeOps(overrides: Partial<RoveOps> = {}): RoveOps {
  return {
    status: mock(async () => payload([])),
    tasks: async () => [
      { id: "01AAAAAAAAAAAAAAAAAAABC123", title: "Fix login", repo: "/r/app" },
      { id: "01AAAAAAAAAAAAAAAAAAXBC123", title: "Add retry", repo: "/r/app" },
      { id: "01AAAAAAAAAAAAAAAAAAQQQ999", title: "Docs", repo: "/r/site" },
    ],
    repos: async () => ["/r/app", "/r/site", "/other/app2"],
    send: mock(async () => ({ tab: "tab-1", started: false })),
    add: mock(async () => ({ taskId: "01NEWNEWNEWNEWNEWNEWNEW777" })),
    gates: async () => [],
    answerGate: mock(async () => ({ delivered: true })),
    clearReport: mock(async () => {}),
    notifyingRoutineRuns: async () => [],
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
  expect(await handleCommand("deploy prod", fakeOps())).toStartWith(`Unknown command "deploy".\n${HELP_TEXT}\n`)
})

it("with an agent bound, free text goes to it and commands keep their meaning", async () => {
  const ops = fakeOps()
  const agent = { taskId: "01AAAAAAAAAAAAAAAAAAQQQ999", tab: "tab-2" }
  expect(await handleInbound("deploy prod please", ops, agent)).toBe("")
  expect(ops.send).toHaveBeenCalledWith(agent.taskId, "tab-2", agentPrompt("deploy prod please", "rove"))
  expect(await handleInbound("help", ops, agent)).toEndWith("Anything else goes to your bound agent.")
  expect(ops.send).toHaveBeenCalledTimes(1)
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

describe("gates and answer", () => {
  const GATE = {
    id: "g-12",
    taskId: "01AAAAAAAAAAAAAAAAAAABC123",
    tabId: null,
    question: "Which approach?",
    options: [
      { key: "a", label: "Rewrite", detail: "2 days" },
      { key: "b", label: "Patch" },
    ],
    recommended: "b",
    status: "open" as const,
    createdAt: "2026-10-12T00:00:00.000Z",
  }
  const FREE = { ...GATE, id: "g-13", options: [], recommended: undefined, question: "What name?" }
  const withGates = (ops: Partial<RoveOps> = {}) => fakeOps({ gates: async () => [GATE, FREE], ...ops })

  it("lists open decisions with their option keys and the recommended one", async () => {
    const reply = await handleCommand("gates", withGates())
    expect(reply).toContain("2 open decisions:")
    expect(reply).toContain("g-12 ABC123 Fix login\nWhich approach?\n  a — Rewrite (2 days)\n  b (recommended) — Patch")
    expect(reply).toContain("g-13 ABC123 Fix login\nWhat name?\n  free text only")
    expect(reply).toContain("Usage: answer g-12 <key> [note]")
  })

  it("says so when nothing is open", async () => {
    expect(await handleCommand("gates", fakeOps())).toBe("No open decisions.")
  })

  it("answer <gate> <key> <note> sends the option and the note", async () => {
    const ops = withGates()
    const reply = await handleCommand("answer g-12 b ship it after lunch", ops)
    expect(ops.answerGate).toHaveBeenCalledWith("g-12", { option: "b", text: "ship it after lunch" })
    expect(reply).toBe("Answered g-12 with b (Patch). Sent to the agent.")
  })

  it("an option alone is an answer; keys match case-insensitively and a bare number names the gate", async () => {
    const ops = withGates({ answerGate: mock(async () => ({ delivered: false })) })
    const reply = await handleCommand("answer 12 A", ops)
    expect(ops.answerGate).toHaveBeenCalledWith("g-12", { option: "a" })
    expect(reply).toContain("Answered g-12 with a (Rewrite).")
    expect(reply).toContain("not running")
  })

  it("a key that is not an option is refused with the valid ones, and nothing is sent", async () => {
    const ops = withGates()
    const reply = await handleCommand("answer g-12 c do it", ops)
    expect(reply).toBe('"c" is not an option of g-12. Options: a, b (or "answer g-12 - <text>").')
    expect(ops.answerGate).not.toHaveBeenCalled()
  })

  it("free text on a gate with options needs the explicit `-`", async () => {
    const ops = withGates()
    await handleCommand("answer g-12 - neither, split it in two", ops)
    expect(ops.answerGate).toHaveBeenCalledWith("g-12", { text: "neither, split it in two" })
    expect(await handleCommand("answer g-12 -", ops)).toBe("Usage: answer g-12 - <text>")
  })

  it("a gate with no options takes everything after the id as the text", async () => {
    const ops = withGates()
    const reply = await handleCommand("answer g-13 call it Nightly Loop", ops)
    expect(ops.answerGate).toHaveBeenCalledWith("g-13", { text: "call it Nightly Loop" })
    expect(reply).toBe("Answered g-13 with your text. Sent to the agent.")
  })

  it("a gate with no options accepts the `-` free-text marker without sending it", async () => {
    const ops = withGates()
    await handleCommand("answer g-13 - call it Nightly Loop", ops)
    expect(ops.answerGate).toHaveBeenCalledWith("g-13", { text: "call it Nightly Loop" })
    expect(await handleCommand("answer g-13 -", ops)).toBe("Usage: answer g-13 - <text>")
  })

  it("an unknown or closed gate and a missing answer are replies, not sends", async () => {
    const ops = withGates()
    expect(await handleCommand("answer g-99 a", ops)).toBe('No open decision "g-99". Send "gates" for the list.')
    expect(await handleCommand("answer nope a", ops)).toBe('No open decision "nope". Send "gates" for the list.')
    expect(await handleCommand("answer g-12", ops)).toBe("Usage: answer g-12 <key> [note]")
    expect(ops.answerGate).not.toHaveBeenCalled()
  })

  it("a daemon refusal comes back as the reply", async () => {
    const ops = withGates({
      answerGate: async () => {
        throw new Error("GATE_NOT_OPEN: g-12 is already answered")
      },
    })
    expect(await handleCommand("answer g-12 a", ops)).toBe("Failed: GATE_NOT_OPEN: g-12 is already answered")
  })
})

describe("clear", () => {
  it("dismisses the named delivery's flag", async () => {
    const clearReport = mock(async () => {})
    const reply = await handleCommand("clear D-41", fakeOps({ clearReport }))
    expect(clearReport).toHaveBeenCalledWith("d-41")
    expect(reply).toContain("d-41")
  })

  it("refuses a malformed id without calling the daemon", async () => {
    const clearReport = mock(async () => {})
    expect(await handleCommand("clear nonsense", fakeOps({ clearReport }))).toContain("Usage: clear d-N")
    expect(clearReport).not.toHaveBeenCalled()
  })

  it("an unknown delivery comes back as the reply", async () => {
    const ops = fakeOps({
      clearReport: async () => {
        throw new ApiError("no delivery d-9", "DELIVERY_NOT_FOUND")
      },
    })
    expect(await handleCommand("clear d-9", ops)).toContain("DELIVERY_NOT_FOUND")
  })
})

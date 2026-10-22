/**
 * The TUI's half of the daemon's row status: it keeps the newest snapshot,
 * and reports only what it alone knows — what it is viewing, and that the
 * user answered a question. Driven through a fake transport (no daemon) and
 * the real event decoder.
 */

import type { RowStatusPayload } from "@sma1lboy/rove-daemon/daemon/row-status-store"
import { afterEach, describe, expect, it } from "vitest"
import { handleOrchestratorEvent } from "../../src/client/remote-orchestrator-events.ts"
import type { OrchestratorSignals } from "../../src/client/remote-orchestrator-payloads.ts"
import type { RowStatusTransport } from "../../src/client/remote-orchestrator-row-status.ts"
import { RowStatusChannel } from "../../src/client/remote-orchestrator-row-status.ts"
import { rowStatusGlyph } from "../../src/lib/row-status-glyph.ts"
import {
  acceptRemoteActivity,
  acceptRowStatus,
  attachRowStatusTransport,
  noteAnswerInput,
  reloadRowStatus,
  reportViewing,
  resetRowStatusForTests,
  rowStatusCell,
  tabRowStatus,
  taskRowStatus,
} from "../../src/tui-react/workspace/row-status-sync.ts"
import { DEFAULT_GLYPHS } from "../../src/tui/lib/glyphs.ts"

const SESSION = { alive: true, restored: false, tracked: true } as const

function payload(rev: number, kind: "running" | "needs-input" | "idle" = "running"): RowStatusPayload {
  return {
    rev,
    tasks: {
      alpha: { task: { kind, since: rev }, tabs: { "tab-1": { kind, since: rev, ...SESSION } } },
      bravo: { task: { kind: "idle", since: 0 }, tabs: {} },
    },
  }
}

function fakeTransport(listed: RowStatusPayload = payload(1)) {
  const calls: { viewing: [string | null, string | null | undefined][]; answered: [string, string][] } = {
    viewing: [],
    answered: [],
  }
  let listener: ((p: RowStatusPayload) => void) | null = null
  const transport: RowStatusTransport = {
    list: async () => listed,
    viewing: async (taskId, tabId) => {
      calls.viewing.push([taskId, tabId])
    },
    answered: async (taskId, tabId) => {
      calls.answered.push([taskId, tabId])
    },
    onChanged: (l) => {
      listener = l
      return () => {
        listener = null
      }
    },
  }
  return { transport, calls, push: (p: RowStatusPayload) => listener?.(p) }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => resetRowStatusForTests())

describe("row status snapshots", () => {
  it("keeps the newest rev and ignores an older one", () => {
    acceptRowStatus(payload(5, "running"))
    acceptRowStatus(payload(3, "idle"))
    expect(taskRowStatus(rowStatusCell.get(), "alpha")?.kind).toBe("running")
    acceptRowStatus(payload(6, "needs-input"))
    expect(tabRowStatus(rowStatusCell.get(), "alpha", "tab-1")?.kind).toBe("needs-input")
  })

  it("keeps an unchanged task's object, so its rows do not re-render", () => {
    acceptRowStatus(payload(1, "running"))
    const before = rowStatusCell.get()
    acceptRowStatus(payload(2, "running"))
    // `since` moved with the rev for alpha; bravo is identical.
    expect(rowStatusCell.get().bravo).toBe(before.bravo)
    expect(rowStatusCell.get().alpha).not.toBe(before.alpha)
  })

  it("a fresh list replaces the snapshot whatever its rev (a restarted daemon counts from zero)", async () => {
    acceptRowStatus(payload(40, "running"))
    const { transport } = fakeTransport(payload(1, "idle"))
    attachRowStatusTransport(transport)
    await flush()
    expect(taskRowStatus(rowStatusCell.get(), "alpha")?.kind).toBe("idle")
  })

  it("follows `row.status` pushes once attached", async () => {
    const { transport, push } = fakeTransport()
    attachRowStatusTransport(transport)
    await flush()
    push(payload(9, "needs-input"))
    expect(taskRowStatus(rowStatusCell.get(), "alpha")?.kind).toBe("needs-input")
  })
})

describe("other machines' tasks (the hub's relayed engine-state)", () => {
  const glyph = (status: Parameters<typeof rowStatusGlyph>[0]) => rowStatusGlyph(status, DEFAULT_GLYPHS)

  it("builds a remote task's tabs and rollup with the daemon's own rule", () => {
    acceptRemoteActivity(
      new Map([["far", { state: "running" as const, at: 5 }]]),
      new Map([
        [
          "far",
          new Map([
            ["tab-1", { state: "running" as const, at: 5 }],
            ["tab-2", { state: "permission_needed" as const, at: 6 }],
          ]),
        ],
      ]),
    )
    const map = rowStatusCell.get()
    expect(glyph(tabRowStatus(map, "far", "tab-1")).spinning).toBe(true)
    expect(glyph(tabRowStatus(map, "far", "tab-2"))).toMatchObject({ glyph: "?", tone: "warning" })
    // The rollup is `taskStatus`'s: a question outranks a running sibling.
    expect(glyph(taskRowStatus(map, "far"))).toMatchObject({ glyph: "?", tone: "warning" })
  })

  it("falls back to the task-level reading when no tab is reported", () => {
    acceptRemoteActivity(new Map([["far", { state: "rate_limited" as const, at: 5 }]]))
    expect(glyph(taskRowStatus(rowStatusCell.get(), "far"))).toMatchObject({ glyph: "!", tone: "warning" })
  })

  it("a local task keeps the daemon's snapshot whatever the relay says", () => {
    acceptRowStatus(payload(1, "idle"))
    acceptRemoteActivity(new Map([["alpha", { state: "running" as const, at: 5 }]]))
    expect(taskRowStatus(rowStatusCell.get(), "alpha")?.kind).toBe("idle")
    // ...and a later snapshot does not drop the remote rows.
    acceptRemoteActivity(new Map([["far", { state: "running" as const, at: 5 }]]))
    acceptRowStatus(payload(2, "needs-input"))
    expect(taskRowStatus(rowStatusCell.get(), "far")?.kind).toBe("running")
    expect(taskRowStatus(rowStatusCell.get(), "alpha")?.kind).toBe("needs-input")
  })
})

describe("what the TUI reports", () => {
  it("sends ui.viewing on every change of task or tab, once per change", async () => {
    const { transport, calls } = fakeTransport()
    attachRowStatusTransport(transport)
    reportViewing("alpha", "tab-1")
    reportViewing("alpha", "tab-1")
    reportViewing("alpha", "tab-2")
    reportViewing(null, null)
    await flush()
    expect(calls.viewing).toEqual([
      ["alpha", "tab-1"],
      ["alpha", "tab-2"],
      [null, null],
    ])
  })

  it("re-sends what it views after a reconnect (the daemon dropped it with the connection)", async () => {
    const { transport, calls } = fakeTransport()
    attachRowStatusTransport(transport)
    reportViewing("alpha", "tab-1")
    await reloadRowStatus()
    expect(calls.viewing).toEqual([
      ["alpha", "tab-1"],
      ["alpha", "tab-1"],
    ])
  })

  it("an enter at a tab the daemon shows waiting on the user reports activity.answered", async () => {
    const { transport, calls } = fakeTransport()
    attachRowStatusTransport(transport)
    acceptRowStatus(payload(2, "needs-input"))
    noteAnswerInput("y", "alpha", "tab-1")
    noteAnswerInput("\r", "alpha", "tab-1")
    noteAnswerInput("\r", "alpha", "tab-9")
    expect(calls.answered).toEqual([["alpha", "tab-1"]])
  })

  it("an enter at a running tab is an ordinary submit, not an answer", () => {
    const { transport, calls } = fakeTransport()
    attachRowStatusTransport(transport)
    acceptRowStatus(payload(2, "running"))
    noteAnswerInput("\r", "alpha", "tab-1")
    expect(calls.answered).toEqual([])
  })
})

describe("the wire", () => {
  it("decodes `row.status` into the channel and drops a malformed one", () => {
    const seen: RowStatusPayload[] = []
    const signals = { emitRowStatus: (p: RowStatusPayload) => seen.push(p) } as unknown as OrchestratorSignals
    handleOrchestratorEvent("row.status", payload(3), signals)
    handleOrchestratorEvent("row.status", { tasks: {} }, signals)
    handleOrchestratorEvent("row.status", { rev: 4, tasks: null }, signals)
    expect(seen.map((p) => p.rev)).toEqual([3])
  })

  it("the channel sends the daemon's RPC names and payload shapes", async () => {
    const requests: [string, unknown][] = []
    const client = {
      request: async (name: string, body?: unknown) => {
        requests.push([name, body])
        return payload(1)
      },
    }
    const channel = new RowStatusChannel(client as never)
    await channel.list()
    await channel.viewing("alpha", "tab-1")
    await channel.viewing("alpha", null)
    await channel.viewing(null)
    await channel.answered("alpha", "tab-1")
    expect(requests).toEqual([
      ["status.list", undefined],
      ["ui.viewing", { taskId: "alpha", tabId: "tab-1" }],
      ["ui.viewing", { taskId: "alpha" }],
      ["ui.viewing", { taskId: null }],
      ["activity.answered", { taskId: "alpha", tabId: "tab-1" }],
    ])
  })
})

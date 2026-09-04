import type { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { describe, expect, it, vi } from "vitest"
import { RemoteOrchestrator } from "../../src/client/remote-orchestrator.ts"

const { logClientError } = vi.hoisted(() => ({ logClientError: vi.fn() }))
vi.mock("@sma1lboy/kobe-daemon/client/client-log", async (importActual) => ({
  ...(await importActual<typeof import("@sma1lboy/kobe-daemon/client/client-log")>()),
  logClientError,
}))

function fakeClient(): { client: KobeDaemonClient; emit: (name: string, payload: unknown) => void } {
  let star: ((frame: { name: string; payload: unknown }) => void) | undefined
  const client = {
    on: (name: string, handler: (frame: { name: string; payload: unknown }) => void) => {
      if (name === "*") star = handler
      return () => {}
    },
    onLifecycle: () => () => {},
  } as unknown as KobeDaemonClient
  return { client, emit: (name, payload) => star?.({ name, payload }) }
}

describe("RemoteOrchestrator attention channel", () => {
  it("replaces the durable Inbox from full snapshots and rejects malformed payloads", () => {
    const { client, emit } = fakeClient()
    const orch = new RemoteOrchestrator(client)
    const item = { taskId: "t1", tabId: "tab-2", state: "permission_needed" as const, unread: true, at: 42 }

    emit("attention.inbox", { items: [item] })
    expect(orch.attentionInboxSignal()()).toEqual([item])

    emit("attention.inbox", { items: "bad" })
    expect(orch.attentionInboxSignal()()).toEqual([item])
    expect(logClientError).toHaveBeenCalledWith("orch", expect.stringContaining("dropped attention.inbox"))

    emit("attention.inbox", { items: [{ ...item, unread: "yes" }] })
    expect(orch.attentionInboxSignal()()).toEqual([item])

    const legacy = { taskId: "t2", tabId: null, state: "turn_complete" as const, at: 43 }
    emit("attention.inbox", { items: [legacy] })
    expect(orch.attentionInboxSignal()()).toEqual([{ ...legacy, unread: true }])

    emit("attention.inbox", { items: [] })
    expect(orch.attentionInboxSignal()()).toEqual([])
  })

  it("keeps a routine episode that NAMES a task, and its siblings with it", () => {
    // The episode `automation-runner.ts` actually files after a firing that
    // built a task and then failed to start its engine: `automation-dispatch`
    // returns `{ status: "dispatch_failed", taskId }` — a STRING — and the
    // daemon persists it. Rejecting that shape used to drop the WHOLE event,
    // so the two unrelated episodes below vanished from the UI too, on every
    // republish and every fresh attach, with nothing on screen to dismiss.
    const { client, emit } = fakeClient()
    const orch = new RemoteOrchestrator(client)
    const permission = { taskId: "task-a", tabId: "tab-1", state: "permission_needed" as const, unread: true, at: 1 }
    const failed = { taskId: "task-b", tabId: "tab-1", state: "error" as const, unread: true, at: 2 }
    const routine = {
      taskId: "task-c",
      tabId: null,
      state: "routine_failed" as const,
      detail: { routine: { automationId: "auto-1", name: "nightly", status: "dispatch_failed" } },
      unread: true,
      at: 3,
    }

    emit("attention.inbox", { items: [permission, failed, routine] })
    expect(orch.attentionInboxSignal()()).toEqual([permission, failed, routine])
  })

  it("a malformed row costs its own row, not the queue", () => {
    const { client, emit } = fakeClient()
    const orch = new RemoteOrchestrator(client)
    const good = { taskId: "task-a", tabId: "tab-1", state: "permission_needed" as const, unread: true, at: 1 }
    // A state this client does not know — what a newer daemon looks like to an
    // older TUI, and the shape that made the entire Inbox read `0`.
    const future = { taskId: "task-b", tabId: "tab-1", state: "invented_later", unread: true, at: 2 }

    emit("attention.inbox", { items: [good, future] })
    expect(orch.attentionInboxSignal()()).toEqual([good])
    expect(logClientError).toHaveBeenCalledWith("orch", expect.stringContaining("dropped 1 malformed"))

    // …but a payload where NOTHING parsed is not evidence of an empty queue:
    // keep the last good snapshot rather than invent one.
    emit("attention.inbox", { items: [future] })
    expect(orch.attentionInboxSignal()()).toEqual([good])
  })
})

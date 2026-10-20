import { describe, expect, it, vi } from "vitest"
import type { AttentionInboxItem } from "../../src/client/remote-orchestrator"
import { dismissEpisode, requestInboxItemOpen } from "../../src/tui-react/workspace/inbox-open-action"

const item: AttentionInboxItem = {
  taskId: "task-1",
  tabId: "tab-2",
  state: "error",
  unread: true,
  at: 123,
}

// Opening RESOLVES the episode (queue-drain model): both
// the available and the unavailable path dismiss it from the daemon store;
// only navigation differs (an unavailable target can't be jumped to).
describe("requestInboxItemOpen", () => {
  it("resolves an available item and allows navigation", () => {
    const rpc = { dismissAttention: vi.fn().mockResolvedValue(undefined), dismissRoutineAttention: vi.fn() }

    expect(requestInboxItemOpen(item, true, rpc, vi.fn())).toBe(true)
    expect(rpc.dismissAttention).toHaveBeenCalledWith("task-1", "tab-2", 123)
  })

  it("resolves an unavailable item without navigating", () => {
    const rpc = { dismissAttention: vi.fn().mockResolvedValue(undefined), dismissRoutineAttention: vi.fn() }

    expect(requestInboxItemOpen(item, false, rpc, vi.fn())).toBe(false)
    expect(rpc.dismissAttention).toHaveBeenCalledWith("task-1", "tab-2", 123)
  })
})

describe("dismissEpisode", () => {
  it("addresses a report_missing episode by its delivery, not task+tab", async () => {
    const rpc = { dismissAttention: vi.fn().mockResolvedValue(true), dismissRoutineAttention: vi.fn() }
    const missing: AttentionInboxItem = {
      taskId: "task-1",
      tabId: null,
      state: "report_missing",
      detail: { delivery: { id: "d-12", cause: "turn-complete" } },
      unread: true,
      at: 456,
    }

    await dismissEpisode(missing, rpc, true)
    expect(rpc.dismissAttention).toHaveBeenCalledWith("task-1", null, 456, "d-12")
  })

  it("opening or visiting a report_missing row never clears it; only the explicit dismiss does", async () => {
    const rpc = { dismissAttention: vi.fn().mockResolvedValue(true), dismissRoutineAttention: vi.fn() }
    const missing: AttentionInboxItem = {
      taskId: "task-1",
      tabId: "tab-1",
      state: "report_missing",
      detail: { delivery: { id: "d-12", cause: "turn-complete" } },
      unread: true,
      at: 456,
    }
    expect(requestInboxItemOpen(missing, true, rpc, vi.fn())).toBe(true)
    await expect(dismissEpisode(missing, rpc)).resolves.toBe(false)
    expect(rpc.dismissAttention).not.toHaveBeenCalled()
    await dismissEpisode(missing, rpc, true)
    expect(rpc.dismissAttention).toHaveBeenCalledWith("task-1", "tab-1", 456, "d-12")
  })
})

// A decision belongs to its gate: only `gate.answer` / `gate.withdraw` end it.
describe("a decision_needed row", () => {
  const decision: AttentionInboxItem = {
    ...item,
    state: "decision_needed",
    detail: { gate: { id: "g-1", question: "?", options: [] } },
  }

  it("is never dismissed, whichever path asks", async () => {
    const rpc = { dismissAttention: vi.fn().mockResolvedValue(true), dismissRoutineAttention: vi.fn() }
    expect(requestInboxItemOpen(decision, true, rpc, vi.fn())).toBe(true)
    await expect(dismissEpisode(decision, rpc)).resolves.toBe(false)
    expect(rpc.dismissAttention).not.toHaveBeenCalled()
  })
})

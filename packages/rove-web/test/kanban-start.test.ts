import { describe, expect, test } from "bun:test"
import type { BridgeClient } from "../src/bridge.ts"

// The i18n module reads the browser's language at import time.
Object.defineProperty(globalThis, "navigator", { value: { language: "en" }, configurable: true })
const { startStory } = await import("../src/kanban-start.ts")

function fakeClient(replies: Record<string, unknown>) {
  const calls: Array<{ op: string; args: unknown }> = []
  const client = {
    request: async (op: string, args?: unknown) => {
      calls.push({ op, args })
      return replies[op] ?? {}
    },
  } as unknown as BridgeClient
  return { client, calls }
}

describe("startStory in the project", () => {
  test("opens a session of its own in the checkout and starts the story's prompt there", async () => {
    const { client, calls } = fakeClient({
      "issue.prompt": { title: "T", prompt: "do it" },
      "task.openCheckout": { taskId: "S1" },
    })

    const res = await startStory(client, {
      repo: "/r",
      issue: { id: 7, title: "T" },
      engine: "codex",
      placement: "project",
    })

    expect(res).toEqual({ taskId: "S1", warnings: [] })
    expect(calls.find((c) => c.op === "tab.new")?.args).toEqual({
      taskId: "S1",
      kind: "engine",
      engine: "codex",
      prompt: "do it",
    })
  })
})

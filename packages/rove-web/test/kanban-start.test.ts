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
  test("lands on the child task the bridge made, not on the main checkout", async () => {
    const { client, calls } = fakeClient({
      "issue.prompt": { title: "T", prompt: "do it" },
      "task.openMain": { taskId: "MAIN" },
      "tab.new": { tabId: "tab-1", taskId: "KID" },
    })

    const res = await startStory(client, {
      repo: "/r",
      issue: { id: 7, title: "T" },
      engine: "codex",
      placement: "project",
    })

    expect(res).toEqual({ taskId: "KID", tabId: "tab-1", warnings: [] })
    expect(calls.find((c) => c.op === "tab.new")?.args).toEqual({
      taskId: "MAIN",
      kind: "engine",
      engine: "codex",
      prompt: "do it",
    })
  })
})

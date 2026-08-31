// @vitest-environment jsdom

/**
 * The header's token chips must distinguish "the engine reported zero" from
 * "the engine reports no usage at all" (kimi's unverified wire, custom
 * engines). Both collapse to 0 once unpacked, so the chips gate on the
 * SNAPSHOT'S PRESENCE, not on its numbers — these cases pin that gate,
 * which `summarizeUsage` unit tests can't see.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MessagesResult } from "../src/lib/history.ts"

const { fetchMessagesMock } = vi.hoisted(() => ({
  fetchMessagesMock: vi.fn<() => Promise<MessagesResult>>(),
}))

vi.mock("../src/lib/history.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/history.ts")>()
  return {
    ...actual,
    fetchSessions: async () => ({ sessions: ["s1"], latestMtime: 1 }),
    fetchMessages: fetchMessagesMock,
  }
})

vi.mock("../src/lib/store.ts", () => ({
  useAppState: () => ({ daemonConnected: true, streamConnected: true }),
}))

import { ChatTranscript } from "../src/components/ChatTranscript.tsx"

afterEach(() => {
  cleanup()
  fetchMessagesMock.mockReset()
})

const show = async () => {
  render(<ChatTranscript worktreePath="/tmp/wt" vendor="claude" />)
  await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalled())
}

describe("transcript header token chips", () => {
  it("renders the in/out chip when the engine reported usage", async () => {
    fetchMessagesMock.mockResolvedValue({
      messages: [],
      usage: { input_tokens: 300, output_tokens: 60 },
    })
    await show()
    await waitFor(() => expect(screen.getByTitle("Session tokens in / out")).toBeTruthy())
  })

  it("renders NO chip when the engine reports no usage — absence is not zero", async () => {
    fetchMessagesMock.mockResolvedValue({ messages: [] })
    await show()
    // Give the state update the same window the positive case needed.
    await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalled())
    expect(screen.queryByTitle("Session tokens in / out")).toBeNull()
  })
})

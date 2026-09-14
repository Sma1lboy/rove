import { describe, expect, it, vi } from "vitest"
import { deliverToExactTab } from "../../src/cli/api/exact-tab-delivery.ts"

describe("Codex prompt submission", () => {
  // The screen is painted with a "tab to queue message" footer and redrawn on
  // every write — including right after the Enter — and delivery still presses
  // Enter: the submit key is no longer read off the engine's repaint, so a
  // hint, fresh or late, can neither switch the key to Tab nor append a
  // delayed Tab.
  it.each([
    { prompt: "continue the work", paste: "continue the work " },
    { prompt: "check @nonexistent-file", paste: "check @nonexistent-file " },
    { prompt: "/status", paste: "/status" },
    { prompt: "!pwd", paste: "!pwd" },
  ])("uses Enter for $prompt even with a queue hint on screen", async ({ prompt, paste }) => {
    const key = "task::tab-2"
    const sent: string[] = []
    let output = "\x1b[?2004htab to queue message"
    const request = vi
      .fn()
      .mockImplementation(async (name: string, payload?: { data?: string; sinceOffset?: number }) => {
        if (name === "pty.list") {
          return { sessions: [{ key, alive: true, pid: 123, command: ["claude"], title: "" }] }
        }
        if (name === "pty.peek") {
          const bytes = Buffer.from(output)
          return {
            exists: true,
            alive: true,
            pid: 123,
            offset: bytes.length,
            data: bytes.subarray(payload?.sinceOffset ?? 0).toString("base64"),
            sinceValid: payload?.sinceOffset !== undefined,
          }
        }
        if (name === "pty.write") {
          const data = payload?.data ?? ""
          sent.push(data)
          if (data.startsWith("\x1b[200~")) output += `\x1b[5;3H${data.slice(6, -6)}tab to queue message`
          if (data === "\r") output += "tab to queue message"
        }
        return {}
      })

    const result = await deliverToExactTab({ request }, "task", "tab-2", ".", prompt, {
      engineBin: "claude",
      snapshot: async () => "123 1 bash\n456 123 codex\n",
    })

    expect(sent).toEqual([`\x1b[200~${paste}\x1b[201~`, "\r"])
    expect(result.delivered).toBe(true)
    expect(result).not.toHaveProperty("queued")
    expect(
      request.mock.calls.every(([name]) => name === "pty.list" || name === "pty.peek" || name === "pty.write"),
    ).toBe(true)
  })
})

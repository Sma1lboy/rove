import { describe, expect, it, vi } from "vitest"
import { deliverToExactTab } from "../../src/cli/api/exact-tab-delivery.ts"

describe("Codex prompt submission", () => {
  it.each([
    { redraw: "none", prompt: "continue the work", paste: "continue the work " },
    { redraw: "paste", prompt: "continue the work", paste: "continue the work " },
    { redraw: "enter", prompt: "continue the work", paste: "continue the work " },
    { redraw: "paste", prompt: "check @nonexistent-file", paste: "check @nonexistent-file " },
    { redraw: "paste", prompt: "/status", paste: "/status" },
    { redraw: "paste", prompt: "!pwd", paste: "!pwd" },
  ])("uses Enter for $prompt with queue hint redraw=$redraw", async ({ redraw, prompt, paste }) => {
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
          if (data.startsWith("\x1b[200~")) {
            output += `\x1b[5;3H${data.slice(6, -6)}`
            if (redraw === "paste") output += "tab to queue message"
          } else if (data === "\r" && redraw === "enter") {
            output += "tab to queue message"
          }
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

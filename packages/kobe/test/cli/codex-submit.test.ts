import { describe, expect, it, vi } from "vitest"
import { deliverToExactTab } from "../../src/cli/api/exact-tab-delivery.ts"

describe("Codex prompt submission", () => {
  it.each([
    { busy: true, prompt: "continue the work", paste: "continue the work ", submit: "\t" },
    { busy: false, prompt: "continue the work", paste: "continue the work ", submit: "\t" },
    { busy: true, prompt: "check @nonexistent-file", paste: "check @nonexistent-file ", submit: "\t" },
    { busy: false, prompt: "check @nonexistent-file", paste: "check @nonexistent-file ", submit: "\t" },
    { busy: false, prompt: "/status", paste: "/status", submit: "\r" },
    { busy: false, prompt: "!pwd", paste: "!pwd", submit: "\r" },
  ])("submits $prompt with busy=$busy without a footer redraw", async ({ busy, prompt, paste, submit }) => {
    const key = "task::tab-2"
    const sent: string[] = []
    let output = `\x1b[?2004h${busy ? "tab to queue message" : "Ask Codex to do anything"}`
    let composer = ""
    let accepted = ""
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
            composer = data.slice(6, -6)
            output += `\x1b[5;3H${composer}`
          } else if ((data === "\t" && !/@\S*$/.test(composer)) || (!busy && data === "\r")) {
            accepted = composer.trim()
            composer = ""
          }
        }
        return {}
      })

    const result = await deliverToExactTab({ request }, "task", "tab-2", ".", prompt, {
      engineBin: "claude",
      snapshot: async () => "123 1 bash\n456 123 codex\n",
    })

    expect(accepted).toBe(prompt)
    expect(composer).toBe("")
    expect(sent).toEqual([`\x1b[200~${paste}\x1b[201~`, submit])
    expect(result.delivered).toBe(true)
    expect(result).not.toHaveProperty("queued")
    expect(
      request.mock.calls.every(([name]) => name === "pty.list" || name === "pty.peek" || name === "pty.write"),
    ).toBe(true)
  })
})

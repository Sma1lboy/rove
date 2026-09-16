import { describe, expect, it, vi } from "vitest"
import { deliverToExactTab } from "../../src/cli/api/exact-tab-delivery.ts"
import { writeHostedPrompt } from "../../src/engine/hosted-session.ts"

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
          if (data.endsWith("\r")) output += "tab to queue message"
        }
        return {}
      })

    const result = await deliverToExactTab({ request }, "task", "tab-2", ".", prompt, {
      engineBin: "claude",
      snapshot: async () => "123 1 bash\n456 123 codex\n",
    })

    expect(sent).toEqual([`\x1b[200~${paste}\x1b[201~`, "\x1b[F\r"])
    expect(result.delivered).toBe(true)
    expect(result).not.toHaveProperty("queued")
    expect(
      request.mock.calls.every(([name]) => name === "pty.list" || name === "pty.peek" || name === "pty.write"),
    ).toBe(true)
  })
})

// Real timers, not a faked 150ms: delivery now takes its session's lock before
// the paste (see `engine/delivery-lock.ts`), and that acquire is real
// filesystem work. Under fake timers the advance ran BEFORE the settle timer
// existed and the delivery never resolved. What this test pins is the key
// ORDER, not the wait, so it pays the 150ms.
it("finishes a pending native paste before Enter, preserving the complete report", async () => {
  const prompt = "报告😀\n".repeat(700)
  let pending = ""
  let composer = ""
  let submitted: string | undefined
  const request = vi.fn().mockImplementation(async (name: string, payload?: { data?: string }) => {
    if (name !== "pty.write") return {}
    const data = payload?.data ?? ""
    if (data.startsWith("\x1b[200~")) {
      pending += data.slice(6, -6)
      return {}
    }
    if (data.startsWith("\x1b[F")) {
      composer += pending
      pending = ""
    }
    if (data.endsWith("\r")) {
      if (pending) pending += "\n"
      else submitted = composer
    }
    return {}
  })
  await writeHostedPrompt({ request }, "task::tab-1", prompt, { ready: true, vendor: "codex" })
  expect(submitted).toBe(`${prompt} `)
  expect(pending).toBe("")
  expect(request.mock.calls.filter(([name]) => name === "pty.write")).toHaveLength(2)
})

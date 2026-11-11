import { describe, expect, it, vi } from "vitest"
import { OPENCODE } from "../../src/engine/contrib-screen-manifests.ts"
import { pastePromptWhenEngineUp } from "../../src/engine/hosted-session-readiness.ts"
import type { HostedSessionRpc } from "../../src/engine/hosted-session.ts"
import { classifyScreen } from "../../src/engine/screen-state.ts"

const dialog =
  "Update Available\r\nA new release v1.19.5 is available.\r\nWould you like to update now?\r\nAsk / Skip / Confirm\r\nenter send"

describe("OpenCode first message behind the update dialog", () => {
  it("recognizes the dialog above an idle footer, but not an update notification", () => {
    expect(classifyScreen(OPENCODE, dialog)).toBe("blocked")
    expect(classifyScreen(OPENCODE, "Update Available\nRun 'opencode upgrade' to update manually.\nenter send")).toBe(
      "idle",
    )
  })

  it.each(["dismiss", "timeout", "exit"] as const)("holds the paste until %s", async (ending) => {
    let cleared = false
    let written = ""
    const writes: string[] = []
    const request = vi.fn(async (name: string, payload?: unknown) => {
      if (name === "pty.list") return { sessions: [{ key: "task::tab-1", alive: true, pid: 42 }] }
      if (name === "pty.peek")
        return {
          alive: !(cleared && ending === "exit"),
          exists: true,
          pid: 42,
          offset: 1,
          cols: 100,
          rows: 30,
          sinceValid: false,
          data: Buffer.from(
            `\x1b[?2004h\x1b[25;1H${dialog}${cleared && ending === "dismiss" ? "\x1b[2J\x1b[Henter send" : ""}${written}`,
          ).toString("base64"),
        }
      if (name === "pty.write") {
        expect(cleared).toBe(true)
        const data = (payload as { data: string }).data
        writes.push(data)
        written += data
        return {}
      }
      throw new Error(`unexpected ${name}`)
    })
    const outcome = await pastePromptWhenEngineUp(
      { request: request as HostedSessionRpc["request"] },
      "task::tab-1",
      "opencode",
      "fix it",
      {
        snapshot: async () => "42 1 /bin/zsh\n43 42 opencode\n",
        timeoutMs: 100,
        intervalMs: 1,
        sleep: async () => {
          cleared = true
          await new Promise((resolve) => setTimeout(resolve, 1))
        },
      },
    )
    if (ending === "dismiss") {
      expect(outcome?.confirmed).toBe(true)
      expect(writes).toEqual(["\x1b[200~fix it\x1b[201~", "\r"])
    } else {
      expect(outcome).toBeNull()
      expect(writes).toEqual([])
    }
  })
})

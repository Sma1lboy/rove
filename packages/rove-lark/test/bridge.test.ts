import { beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type LarkEvent, type LarkOps, createLarkBridge } from "../src/bridge.ts"
import { agentBrief } from "../src/brief.ts"
import { LarkStore } from "../src/store.ts"

const BOT = "ou_bot"
const OWNER = "ou_owner"
const TIMINGS = { pollMs: 1, warmupMs: 5, maxMs: 1_000 }

const event = (id: string, over: Partial<LarkEvent> = {}): string =>
  JSON.stringify({
    sender_type: "user",
    sender_id: OWNER,
    chat_type: "p2p",
    chat_id: "oc_1",
    message_id: id,
    content: `text ${id}`,
    ...over,
  })

let store: LarkStore
let running: boolean[]
let reactions: [string, string][]
let ops: LarkOps & { [K in keyof LarkOps]: ReturnType<typeof mock> }
let clock: number

beforeEach(() => {
  store = new LarkStore(mkdtempSync(join(tmpdir(), "rove-lark-")))
  store.writeConfig({ botOpenId: BOT, botName: "Sma1lAgent", allow: [OWNER], tone: "terse", savedAt: "2026-11-26" })
  running = []
  reactions = []
  clock = 0
  ops = {
    taskExists: mock(async () => true),
    openAgentTask: mock(async () => ({ taskId: "01AGENT" })),
    newConversation: mock(async () => ({ tab: "tab-1" })),
    send: mock(async () => {}),
    // Each poll reads the next scripted state; past the script the turn has ended.
    taskRunning: mock(async () => running.shift() ?? false),
  }
})

function bridge() {
  return createLarkBridge(
    {
      ops,
      store,
      react: async (id, emoji) => reactions.push([id, emoji]),
      log: () => {},
      sleep: async () => {
        clock += 1
      },
      now: () => clock,
    },
    TIMINGS,
  )
}

describe("a Lark message", () => {
  it("opens the agent with its brief once, then talks to it; each gets OnIt, then DONE when the turn ends", async () => {
    const b = bridge()
    running = [true, true]
    await b.onLine(event("om_1"))
    expect(ops.openAgentTask).toHaveBeenCalledWith(store.agentDir, "Lark")
    expect(ops.newConversation.mock.calls[0]?.[1]).toStartWith(`${agentBrief("Sma1lAgent", "rove")}\nTONE: terse`)
    expect(ops.newConversation.mock.calls[0]?.[1]).toContain("message_id=om_1 root_id=om_1")
    await b.idle()
    expect(reactions).toEqual([
      ["om_1", "OnIt"],
      ["om_1", "DONE"],
    ])

    await b.onLine(event("om_2", { chat_type: "group", mentions: [{ id: BOT }], root_id: "om_1" }))
    expect(ops.openAgentTask).toHaveBeenCalledTimes(1)
    expect(ops.send).toHaveBeenCalledWith(
      "01AGENT",
      "tab-1",
      expect.stringContaining("[Lark] group oc_1 from ou_owner"),
    )
  })

  it("a changed tone is announced with the next message", async () => {
    const b = bridge()
    await b.onLine(event("om_1"))
    store.writeConfig({ ...store.readConfig()!, tone: "warm" })
    await b.onLine(event("om_2"))
    expect(ops.send.mock.calls[0]?.[2]).toStartWith("[Lark tone] warm\n\n[Lark] DM")
  })

  it.each([
    ["a bot", { sender_type: "bot" }],
    ["a group message that does not @ the bot", { chat_type: "group" }],
    ["someone not allowed", { sender_id: "ou_stranger" }],
  ])("from %s never reaches the agent", async (_, over) => {
    await bridge().onLine(event("om_1", over))
    expect(ops.openAgentTask).not.toHaveBeenCalled()
    expect(reactions).toEqual([])
  })

  it("redelivered by Lark reaches the agent once", async () => {
    const b = bridge()
    await b.onLine(event("om_1"))
    await b.onLine(event("om_1"))
    expect(ops.newConversation).toHaveBeenCalledTimes(1)
    expect(ops.send).not.toHaveBeenCalled()
  })

  it("that cannot be delivered is marked ERROR", async () => {
    ops.openAgentTask.mockImplementation(async () => {
      throw new Error("daemon refused")
    })
    await bridge().onLine(event("om_1"))
    expect(reactions).toEqual([
      ["om_1", "OnIt"],
      ["om_1", "ERROR"],
    ])
  })
})

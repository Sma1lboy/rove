import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectorOps } from "../src/ops/connectors.ts"
import { fakeApi } from "./task-ops-harness.ts"

const before = process.env.ROVE_HOME_DIR
let home = ""

afterEach(() => {
  restoreEnv("ROVE_HOME_DIR", before)
  rmSync(home, { recursive: true, force: true })
})

const chat = () => connectorOps["connectors.chat"]?.run({}, { api: fakeApi().api })

test("connectors.chat says WeChat and Lark are connected once each is bound", async () => {
  home = mkdtempSync(join(tmpdir(), "rove-connectors-"))
  process.env.ROVE_HOME_DIR = home
  expect(await chat()).toEqual({
    connectors: [
      { id: "weixin", connectable: false, connected: false },
      { id: "lark", connectable: true, connected: false },
    ],
  })

  mkdirSync(join(home, ".rove", "weixin"), { recursive: true })
  writeFileSync(
    join(home, ".rove", "weixin", "account.json"),
    JSON.stringify({ accountId: "bot@im.bot", token: "t", savedAt: "2026-10-04T12:00:00.000Z" }),
  )
  mkdirSync(join(home, ".rove", "lark"), { recursive: true })
  writeFileSync(
    join(home, ".rove", "lark", "config.json"),
    JSON.stringify({ botOpenId: "ou_bot", allow: [], savedAt: "2026-11-26T12:00:00.000Z" }),
  )
  expect(await chat()).toEqual({
    connectors: [
      { id: "weixin", connectable: false, connected: true, since: "2026-10-04T12:00:00.000Z", allow: [] },
      {
        id: "lark",
        connectable: true,
        connected: true,
        since: "2026-11-26T12:00:00.000Z",
        allow: [],
        tone: "简短直接，像同事聊天，结论先说，不客套",
      },
    ],
  })
})

const run = (op: string, args: Record<string, unknown>) => connectorOps[op]?.run(args, { api: fakeApi().api })

test("Settings changes a connector's allowed senders and tone, and disconnects it", async () => {
  home = mkdtempSync(join(tmpdir(), "rove-connectors-"))
  process.env.ROVE_HOME_DIR = home
  mkdirSync(join(home, ".rove", "lark"), { recursive: true })
  writeFileSync(join(home, ".rove", "lark", "config.json"), JSON.stringify({ botOpenId: "ou_bot", botName: "Bot" }))

  await run("connectors.chatUpdate", { id: "lark", allow: ["ou_a", " ou_a", "ou_b"], tone: "warm" })
  expect(await chat()).toMatchObject({
    connectors: [{ id: "weixin" }, { id: "lark", allow: ["ou_a", "ou_b"], tone: "warm" }],
  })

  expect(await run("connectors.chatDisconnect", { id: "lark" })).toEqual({ removed: true })
  expect(await chat()).toMatchObject({
    connectors: [{ id: "weixin" }, { id: "lark", connectable: true, connected: false }],
  })
})

function restoreEnv(key: string, prev: string | undefined): void {
  if (prev === undefined) Reflect.deleteProperty(process.env, key)
  else process.env[key] = prev
}

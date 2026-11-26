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
      { id: "weixin", connected: false },
      { id: "lark", connected: false },
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
      { id: "weixin", connected: true, since: "2026-10-04T12:00:00.000Z" },
      { id: "lark", connected: true, since: "2026-11-26T12:00:00.000Z" },
    ],
  })
})

function restoreEnv(key: string, prev: string | undefined): void {
  if (prev === undefined) Reflect.deleteProperty(process.env, key)
  else process.env[key] = prev
}

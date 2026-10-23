/** @jsxImportSource @opentui/react */
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type KVContext, useKV } from "../../src/tui-react/context/kv"
import { AttentionInboxPane } from "../../src/tui-react/workspace/AttentionInboxPane"
import { readInboxVisits, writeInboxVisit } from "../../src/tui-react/workspace/inbox-visits"
import { type Task, toTaskId } from "../../src/types/task"
import { act, renderComponent } from "./harness"

let previousHome: string | undefined
beforeAll(() => {
  previousHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-inbox-follow-"))
})
afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = previousHome
})

const tasks: Task[] = ["Local visit", "Remote visit"].map((title) => ({
  id: toTaskId(title),
  title,
  repo: "/repos/fixture",
  branch: "main",
  worktreePath: "/repos/fixture",
  kind: "task",
  status: "in_progress",
  createdAt: "2026-10-23T00:00:00Z",
  updatedAt: "2026-10-23T00:00:00Z",
}))

test("an open Inbox follows another window's visit after its own quiet flush", async () => {
  let context: KVContext | undefined
  function Inbox() {
    const kv = useKV()
    if (!context) {
      writeInboxVisit(kv, { taskId: "Local visit", tabId: null, at: Date.now() })
      kv.flush()
    }
    context = kv
    return (
      <AttentionInboxPane
        items={[]}
        tasks={tasks}
        kv={kv}
        onOpen={() => {}}
        onOpenTask={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />
    )
  }
  const { frame } = await renderComponent(<Inbox />, { width: 90, height: 30, providers: { kv: true } })
  expect(await frame()).toContain("Local visit")
  const initial = await frame()
  expect(initial.indexOf("Local visit")).toBeLessThan(initial.indexOf("Remote visit"))
  if (!context) throw new Error("KV provider did not mount")
  const kv = context
  await act(async () => {
    kv.follow({ inboxVisits: [{ taskId: "Remote visit", tabId: null, at: Date.now() }, ...readInboxVisits(kv)] })
  })
  const updated = await frame()
  expect(updated).toContain("Remote visit")
  expect(updated.indexOf("Remote visit")).toBeLessThan(updated.indexOf("Local visit"))
})

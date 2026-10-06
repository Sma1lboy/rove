import { afterEach, beforeEach, expect } from "bun:test"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import { TASK_OPS } from "../src/ops/tasks.ts"
import type { BridgeApi } from "../src/ops/types.ts"

export type Call = { verb: string; argv: readonly string[] } | { rpc: string; payload: unknown }

/** Records every verb/RPC and answers from canned replies keyed by name. */
export function fakeApi(replies: Record<string, unknown> = {}): { api: BridgeApi; calls: Call[] } {
  const calls: Call[] = []
  const reply = (name: string): unknown => {
    const r = replies[name]
    return typeof r === "function" ? (r as () => unknown)() : r
  }
  const api: BridgeApi = {
    async verb(name, argv) {
      calls.push({ verb: name, argv })
      return reply(name) as never
    },
    async rpc(name, payload) {
      calls.push({ rpc: name, payload })
      return reply(name) as never
    },
  }
  return { api, calls }
}

export const ENGINES = { engines: [{ id: "claude" }, { id: "codex" }] }
export const REPO = "/work/payments-api"
export const TASKS = { tasks: [{ repo: REPO }] }
export const T = "01M4756MVZKGC84R07M659BEJW"

export async function run(op: string, args: Record<string, unknown>, replies: Record<string, unknown> = {}) {
  const { api, calls } = fakeApi({ "engine-list": ENGINES, "task.list": TASKS, ...replies })
  const spec = TASK_OPS[op]
  if (!spec) throw new Error(`no op ${op}`)
  const result = await spec.run(args, { api })
  return { result, calls }
}

export async function refused(op: string, args: Record<string, unknown>, replies: Record<string, unknown> = {}) {
  const { api, calls } = fakeApi({ "engine-list": ENGINES, "task.list": TASKS, ...replies })
  await expect(TASK_OPS[op]?.run(args, { api })).rejects.toMatchObject({ name: "BridgeError" })
  // Nothing that changes state ran.
  expect(
    calls.filter(
      (c) =>
        ("verb" in c && c.verb !== "engine-list") ||
        ("rpc" in c && c.rpc !== "task.list" && c.rpc !== "worktree.discoverAdoptable"),
    ),
  ).toEqual([])
}

/** Each test starts with no saved repos and gets the real deps back afterwards. */
export function isolateTaskOpDeps(): void {
  const saved = { ...taskOpDeps }
  beforeEach(() => {
    taskOpDeps.savedRepos = () => []
  })
  afterEach(() => {
    Object.assign(taskOpDeps, saved)
  })
}

/**
 * Session PRs (`task.sessionPrs`): polled by URL on their own schedule keys,
 * for tasks that own no branch. Same harness as pr-status-poller.test.ts: a
 * REAL Orchestrator + on-disk store with an injected URL runner.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  PR_FAILURE_BASE_MS,
  type PrPollSchedule,
  type PrStatusPassOptions,
  type PrUrlRunner,
  type PrViewRunner,
  SETTLED_BACKOFF_MS,
  runPrStatusPass as runPrStatusPassRaw,
} from "@sma1lboy/rove-daemon/daemon/pr-status-collector"
import { canonicalPrUrl } from "@sma1lboy/rove-daemon/daemon/session-prs"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

const runPrStatusPass = (orchestrator: Orchestrator, options: Omit<PrStatusPassOptions, "runtime">) =>
  runPrStatusPassRaw(orchestrator, { ...options, runtime: daemonRuntime })

let tmpRoot: string
let store: TaskIndexStore
let orch: Orchestrator

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-sessionpr-"))
  store = new TaskIndexStore({ homeDir: path.join(tmpRoot, "home") })
  await store.load()
  orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

const emptyRunner: PrViewRunner = async () => ({ kind: "empty" })

/** Cancel jitter (rand 0.5 → no offset) so the scheduled delays are exact. */
const noJitter = (): number => 0.5

const url = "https://github.com/o/r/pull/9"

/** A `kind: "main"` task: no branch or worktree of its own, only the PRs its session attached. */
async function makeMainTask(urls: string[] = [url]): Promise<string> {
  const task = await orch.createTask({ repo: "/repo" })
  await store.update(task.id, { kind: "main", sessionPrs: urls.map((u) => ({ url: u, addedAt: "t0" })) })
  return task.id
}

function urlRunner(state: string, polled: string[] = []): PrUrlRunner {
  return async (u) => {
    polled.push(u)
    return {
      kind: "pr",
      view: { number: 9, state, url: u, statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }] },
    }
  }
}

describe("session PR polling", () => {
  test("a main task's PR is polled by url, written on its entry, and re-polled on the tick cadence", async () => {
    const id = await makeMainTask()
    const branchRun = vi.fn(emptyRunner)
    const polled: string[] = []
    const schedule: PrPollSchedule = new Map()
    const pass = (now: number) =>
      runPrStatusPass(orch, {
        run: branchRun,
        runUrl: urlRunner("OPEN", polled),
        now,
        at: "t",
        schedule,
        tickMs: 30_000,
        rand: noJitter,
      })
    expect(await pass(0)).toEqual([id])
    expect(orch.getTask(id)?.sessionPrs?.[0]?.status).toMatchObject({
      lifecycle: "open",
      checkState: "passing",
      number: 9,
    })
    expect(branchRun).not.toHaveBeenCalled()
    expect(schedule.get(`${id}::pr::${url}`)?.nextAllowedAt).toBe(30_000)

    expect(await pass(10_000)).toEqual([])
    expect(polled).toHaveLength(1)
    expect(await pass(30_000)).toEqual([]) // polled again, nothing changed
    expect(polled).toHaveLength(2)
  })

  test("a merged PR backs off to the settled cadence", async () => {
    const id = await makeMainTask()
    const schedule: PrPollSchedule = new Map()
    await runPrStatusPass(orch, {
      run: emptyRunner,
      runUrl: urlRunner("MERGED"),
      now: 0,
      at: "t",
      schedule,
      rand: noJitter,
    })
    expect(orch.getTask(id)?.sessionPrs?.[0]?.status?.lifecycle).toBe("merged")
    expect(schedule.get(`${id}::pr::${url}`)?.nextAllowedAt).toBe(SETTLED_BACKOFF_MS)
  })

  test("a gh error keeps the last status and backs off; each url keeps its own schedule", async () => {
    const other = "https://github.com/o/r/pull/10"
    const id = await makeMainTask([url, other])
    const schedule: PrPollSchedule = new Map()
    const base = { run: emptyRunner, at: "t", schedule, rand: noJitter }
    await runPrStatusPass(orch, { ...base, runUrl: urlRunner("OPEN"), now: 0 })
    const failing: PrUrlRunner = async (u) => (u === url ? { kind: "error", error: "network" } : urlRunner("OPEN")(u))
    await runPrStatusPass(orch, { ...base, runUrl: failing, now: 40_000 })
    expect(orch.getTask(id)?.sessionPrs?.[0]?.status?.checkState).toBe("passing")
    expect(schedule.get(`${id}::pr::${url}`)).toEqual({ nextAllowedAt: 40_000 + PR_FAILURE_BASE_MS, failures: 1 })
    expect(schedule.get(`${id}::pr::${other}`)?.failures).toBe(0)
  })

  test("remote tasks are not polled, and keys of detached urls and deleted tasks are dropped", async () => {
    const id = await makeMainTask()
    const remote = await makeMainTask()
    await store.update(remote, { repo: "ssh://host/repo" })
    const stale = { nextAllowedAt: 0, failures: 0 }
    const schedule: PrPollSchedule = new Map([
      [`${id}::pr::https://github.com/o/r/pull/1`, stale],
      [`gone::pr::${url}`, stale],
    ])
    const polled: string[] = []
    await runPrStatusPass(orch, {
      run: emptyRunner,
      runUrl: urlRunner("OPEN", polled),
      now: 1,
      at: "t",
      schedule,
      rand: noJitter,
    })
    expect(polled).toEqual([url])
    expect([...schedule.keys()]).toEqual([`${id}::pr::${url}`])
  })
})

describe("canonicalPrUrl", () => {
  test.each([
    "https://github.com/o/r/pull/9",
    "http://github.com/o/r/pull/9",
    "https://www.github.com/o/r/pull/9",
    "https://github.com/o/r/pull/9/files",
    "https://github.com/o/r/pull/9#issuecomment-1",
    "https://github.com/o/r/pull/9?diff=split",
    "  https://github.com/o/r/pull/9\n",
  ])("%j → the canonical link", (input) => {
    expect(canonicalPrUrl(input)).toBe(url)
  })

  test.each([
    "https://github.com/o/r/issues/9",
    "https://github.com/o/r/pull/",
    "https://github.com/o/r/pull/9x",
    "https://github.com/o/r",
    "https://gitlab.com/o/r/pull/9",
    "https://evilgithub.com/o/r/pull/9",
    "ssh://github.com/o/r/pull/9",
    "o/r#9",
    "",
  ])("%j is rejected", (input) => {
    expect(canonicalPrUrl(input)).toBeUndefined()
  })
})

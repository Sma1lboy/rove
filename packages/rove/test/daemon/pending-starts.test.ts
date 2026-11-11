/** "Later": a pending start creates nothing until its time, survives a restart, and a missed one runs at startup. */

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ApiParams } from "@sma1lboy/rove-daemon/daemon/protocol"
import { describe, expect, it } from "vitest"
import type { DaemonTask } from "../../../rove-daemon/src/daemon/contracts.ts"
import { PendingStartsStore } from "../../../rove-daemon/src/daemon/pending-starts-store.ts"
import { type ScheduledStartDeps, startScheduledStartRunner } from "../../../rove-daemon/src/daemon/scheduled-start.ts"

const NOW = Date.parse("2026-11-11T09:00:00.000Z")
const later = { at: "2026-11-11T08:00:00.000Z", prompt: "nightly sweep", title: "nightly sweep", repo: "/w/app" }

function harness(store: PendingStartsStore, invoke: (verb: string, params: ApiParams) => unknown) {
  const calls: string[] = []
  const deps: ScheduledStartDeps = {
    orch: {
      listTasks: () => [],
      getTask: () => undefined,
      setScheduledStart: async () => {},
      setPrompt: async (id, p) => void calls.push(`prompt:${id}:${p}`),
      ensureMainTask: async (repo) => ({ id: "main", repo }) as DaemonTask,
      openDirectoryTask: async (input) => {
        calls.push(`openDir:${input.dir}:${input.title}`)
        return { id: "d1" } as DaemonTask
      },
    },
    runtime: {
      startTaskSessionWithPrompt: async (_link, id, p) => {
        calls.push(`start:${id}:${p}`)
        return { started: true }
      },
    },
    link: {} as never,
    pending: store,
    invoke: async (verb, params) => {
      calls.push(`${verb}:${JSON.stringify(params)}`)
      return invoke(verb, params) as never
    },
  }
  return { deps, calls }
}

/** One immediate tick at `now`, the way the daemon's first tick after a start runs. */
async function tickAt(deps: ScheduledStartDeps, now: number): Promise<void> {
  const stop = startScheduledStartRunner(deps, 60_000, () => now)
  await stop()
}

const home = () => join(mkdtempSync(join(tmpdir(), "rove-pending-")), "pending-starts.json")

describe("pending starts", () => {
  it("are kept on disk, and one that came due while the daemon was down runs on its first tick", async () => {
    const path = home()
    const before = new PendingStartsStore(path)
    await before.init()
    await before.add({ ...later, create: { via: "add", params: { repo: "/w/app", command: "claude" } } })

    // A new daemon process reads the record back; the add carries the prompt only now.
    const after = new PendingStartsStore(path)
    await after.init()
    const { deps, calls } = harness(after, () => ({ ok: true, result: {} }))
    await tickAt(deps, NOW)

    expect(calls).toEqual([`add:${JSON.stringify({ repo: "/w/app", command: "claude", prompt: "nightly sweep" })}`])
    expect(after.list()).toEqual([])
  })

  it("create nothing before their time", async () => {
    const store = new PendingStartsStore(home())
    await store.init()
    await store.add({ ...later, at: "2026-11-11T10:00:00.000Z", create: { via: "add", params: { repo: "/w/app" } } })
    const { deps, calls } = harness(store, () => ({ ok: true, result: {} }))
    await tickAt(deps, NOW)
    expect(calls).toEqual([])
    expect(store.list()).toHaveLength(1)
  })

  it("stay listed with the error when the start fails, and are not tried again", async () => {
    const store = new PendingStartsStore(home())
    await store.init()
    await store.add({ ...later, create: { via: "add", params: { repo: "/w/app" } } })
    const refused = { ok: false, error: { code: "NOT_A_REPO", message: "gone" } }
    const { deps, calls } = harness(store, () => refused)
    await tickAt(deps, NOW)
    await tickAt(deps, NOW)
    expect(calls).toHaveLength(1)
    expect(store.list()).toMatchObject([{ error: "NOT_A_REPO: gone" }])
  })

  it("open a project's own checkout as a session with the prompt", async () => {
    const store = new PendingStartsStore(home())
    await store.init()
    await store.add({ ...later, create: { via: "dir", dir: "/w/app", project: true } })
    const { deps, calls } = harness(store, () => ({ ok: true }))
    await tickAt(deps, NOW)
    expect(calls).toEqual(["openDir:/w/app:nightly sweep", "prompt:d1:nightly sweep", "start:d1:nightly sweep"])
  })
})

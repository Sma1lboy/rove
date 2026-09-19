/**
 * The UI-facing half of a background task deletion, over the real socket.
 *
 * `rove api delete` returns `{queued: true}` and destroys the worktree behind
 * it, so the row a user is looking at has to leave the list on the ACCEPTANCE,
 * not on the removal — and has to come back, with a reason, when the removal
 * fails. The three properties pinned here are the ones that make that safe:
 * the accepted-deletion snapshot is broadcast strictly before anything is
 * destroyed, a failure both restores the row and says why, and a REFUSED
 * delete never publishes a deletion at all (so no row flashes out and back).
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task } from "../../src/types/task.ts"
import { bootDaemonHarness, waitFor } from "./harness.ts"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

interface Fixture {
  readonly task: Task
  readonly orch: Orchestrator
  readonly client: KobeDaemonClient
  /** Every channel frame this client received, in arrival order. */
  readonly events: ReadonlyArray<{ name: string; payload: unknown }>
  /** Did a `task.snapshot` carry this task with the given deletion phase? */
  sawPhase(phase: string): boolean
  /** The `notice.event` toasts that reached the client. */
  notices(): Array<{ title: string; body?: string; kind: string; taskId?: string }>
}

/** Boot a daemon over a real socket with one task and an injectable removal. */
async function boot(worktrees: Partial<GitWorktreeManager>): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "kobe-delete-background-"))
  const store = new TaskIndexStore({ homeDir: home })
  await store.load()
  const task = await store.create({
    repo: "/repo",
    title: "large task",
    branch: "kobe/large-task",
    worktreePath: "/wt/large-task",
    status: "backlog",
    kind: "task",
    vendor: "claude",
  })
  const orch = new Orchestrator({
    store,
    worktrees: { isDirty: async () => false, ignoredWork: async () => [], ...worktrees } as GitWorktreeManager,
  })
  const harness = await bootDaemonHarness({ orchestrator: orch })
  const client = harness.client()
  cleanups.push(async () => {
    await harness.close()
    orch.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const events: Array<{ name: string; payload: unknown }> = []
  client.on("*", (frame) => {
    events.push({ name: frame.name, payload: frame.payload })
  })
  await client.connect()
  await client.subscribe()
  return {
    task,
    orch,
    client,
    events,
    sawPhase(phase) {
      return events.some(
        (event) =>
          event.name === "task.snapshot" &&
          (event.payload as { tasks?: Array<{ id: string; deletion?: { phase?: string } }> }).tasks?.some(
            (row) => row.id === task.id && row.deletion?.phase === phase,
          ),
      )
    },
    notices() {
      return events
        .filter((event) => event.name === "notice.event")
        .map((event) => event.payload as { title: string; body?: string; kind: string; taskId?: string })
    },
  }
}

describe("background deletion over the daemon socket", () => {
  it("broadcasts the accepted deletion before it destroys anything", async () => {
    // Never resolves until released: while this is pending, NOTHING has been
    // destroyed — which is the window the queued snapshot has to land in.
    let releaseRemoval: (() => void) | undefined
    const remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseRemoval = resolve
        }),
    )
    const f = await boot({ remove })
    cleanups.push(async () => releaseRemoval?.())

    const response = f.client.request("task.delete", { taskId: f.task.id })
    await expect(
      Promise.race([
        response.then(() => "returned"),
        new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 500)),
      ]),
    ).resolves.toBe("returned")

    // The teardown has STARTED and cannot have finished (the fake is pending),
    // and the queued snapshot — the push a UI drops its row on — is already
    // out. Move the acceptance write after the removal and this never arrives.
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(f.sawPhase("queued")).toBe(true))
    expect(f.orch.getTask(f.task.id)).toBeDefined()

    releaseRemoval?.()
    expect(await waitFor(() => f.orch.getTask(f.task.id) === undefined)).toBe(true)
  })

  it("restores the row and says why when the removal fails", async () => {
    const f = await boot({
      remove: vi.fn(async () => {
        throw new Error("worktree is locked")
      }),
    })

    await f.client.request("task.delete", { taskId: f.task.id })

    // The row comes back: the task is still indexed, now in `error` — which is
    // the phase the sidebar keeps rendering (with its `delete failed` caption).
    expect(await waitFor(() => f.orch.getTask(f.task.id)?.deletion?.phase === "error")).toBe(true)
    // And the reason reaches the user, not just `daemon.log`.
    await vi.waitFor(() => expect(f.notices()).toHaveLength(1))
    const [toast] = f.notices()
    expect(toast?.kind).toBe("error")
    expect(toast?.taskId).toBe(f.task.id)
    expect(toast?.title).toContain("large task")
    expect(toast?.body).toContain("worktree is locked")
  })

  it("publishes no deletion at all when the request is refused", async () => {
    // A dirty worktree without --force is refused synchronously, before the
    // acceptance is ever written — so no row may flash out and back.
    const remove = vi.fn(async () => {})
    const f = await boot({ isDirty: async () => true, remove })

    await expect(f.client.request("task.delete", { taskId: f.task.id })).rejects.toThrow()

    expect(f.sawPhase("queued")).toBe(false)
    expect(f.sawPhase("running")).toBe(false)
    expect(f.orch.getTask(f.task.id)?.deletion).toBeUndefined()
    expect(remove).not.toHaveBeenCalled()
  })
})

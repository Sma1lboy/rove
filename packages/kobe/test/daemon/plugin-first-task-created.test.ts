/**
 * The FIRST task mutation after a daemon start must reach an event plugin.
 *
 * The daemon publishes a baseline `task.snapshot` while wiring the
 * orchestrator, long before the plugin host exists. The host's reducer treats
 * the first snapshot it sees as baseline, so without a replay of the bus's
 * last-value cache the first real mutation IS that baseline and every plugin
 * misses the first `task.created` of the daemon's life.
 *
 * Driven end to end: a real daemon, a real registry entry, a real spawned
 * hook writing a real file — a reducer unit test would not have caught the
 * bug, which lives in the wiring order, not in the reducer.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Orchestrator } from "../../src/orchestrator/core.ts"
import { type DaemonHarness, bootDaemonHarness, waitFor } from "./harness.ts"

const PLUGIN_ID = "test.first-created"

const TASK = {
  id: "t1",
  title: "first after start",
  repo: "/repo",
  branch: "b",
  worktreePath: "/wt",
  status: "idle",
  vendor: "claude",
  createdAt: 1,
  updatedAt: 1,
}

/** Plugin root + registry entry, written into the temp home before boot. */
function seedPlugin(dir: string): void {
  const root = join(dir, "plugin")
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, "rove-plugin.toml"),
    [
      `id = "${PLUGIN_ID}"`,
      'name = "First Created Probe"',
      'version = "0.0.1"',
      'min_rove_version = "0.0.1"',
      "",
      "[[events]]",
      'on = "task.created"',
      `command = ["sh", "-c", "echo \\"$ROVE_PLUGIN_TASK_ID\\" >> \\"$ROVE_PLUGIN_STATE_DIR/hits.txt\\""]`,
      "",
    ].join("\n"),
  )
  mkdirSync(join(dir, ".rove"), { recursive: true })
  writeFileSync(
    join(dir, ".rove", "plugins.json"),
    JSON.stringify({
      version: 1,
      plugins: [{ id: PLUGIN_ID, source: { kind: "link" }, root, enabled: true, version: "0.0.1", installedAt: 1 }],
    }),
  )
}

function hits(harness: DaemonHarness): string[] {
  const file = join(harness.dir, ".rove", "plugins", PLUGIN_ID, "state", "hits.txt")
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean)
}

/** Boot with `baseline` as the pre-existing task list; returns a pusher for
 *  later snapshots (the real orchestrator's `subscribeTasks` shape). */
async function bootWith(baseline: unknown[]): Promise<{ harness: DaemonHarness; push: (tasks: unknown[]) => void }> {
  let listener: ((snapshot: unknown[]) => void) | undefined
  const orchestrator = {
    // The real orchestrator fires eagerly with the current list; that eager
    // baseline is what the bug swallowed.
    subscribeTasks: (sink: (snapshot: unknown[]) => void) => {
      listener = sink
      sink(baseline)
      return () => {}
    },
    listTasks: () => baseline,
    getTask: () => undefined,
  } as unknown as Orchestrator
  const harness = await bootDaemonHarness({
    orchestrator,
    seedHome: seedPlugin,
    server: { plugins: { binPath: "sh" } },
  })
  return { harness, push: (tasks) => listener?.(tasks) }
}

describe("plugin events across a daemon start", () => {
  it("fires task.created for the FIRST mutation, not just the second", async () => {
    const { harness, push } = await bootWith([])
    try {
      push([TASK])
      expect(await waitFor(() => hits(harness).length > 0, 3000)).toBe(true)
      expect(hits(harness)).toEqual(["t1"])
    } finally {
      await harness.close()
    }
  })

  it("does not replay pre-existing tasks as creates", async () => {
    const { harness, push } = await bootWith([TASK])
    try {
      push([TASK, { ...TASK, id: "t2", title: "second" }])
      expect(await waitFor(() => hits(harness).length > 0, 3000)).toBe(true)
      // Only the new one: the seeded baseline must stay a baseline.
      await new Promise((r) => setTimeout(r, 200))
      expect(hits(harness)).toEqual(["t2"])
    } finally {
      await harness.close()
    }
  })
})

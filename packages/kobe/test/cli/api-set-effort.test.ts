/**
 * `set-effort` — which engine's levels govern a task, and what the verb is
 * allowed to write back.
 *
 * Split out of `api-handlers-more.test.ts` (file-size cap) along its own seam:
 * those pin the generic simple-RPC edit verbs, where the payload IS the
 * behaviour. This one is about ENGINE RESOLUTION — `taskEngine` picking the
 * right levels to validate against, and the write-back deliberately not
 * changing which engine a task says it is. Its sibling `api-add-effort.test.ts`
 * covers the same gate on the create side.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

/**
 * Register a `mycodex` preset declaring the codex protocol, in a throwaway
 * KOBE_HOME_DIR. `engine-presets.ts` reads state.json per call, so writing the
 * file is the whole registration.
 */
function withPreset(): void {
  const home = mkdtempSync(join(tmpdir(), "kobe-api-effort-"))
  presetHomes.push(home)
  const dir = join(home, ".config", "rove")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({
      customEngineIds: ["mycodex"],
      "engineCommand.mycodex": "codex",
      "engineProtocol.mycodex": "codex",
      "engineName.mycodex": "My Codex",
    }),
    "utf8",
  )
  process.env.KOBE_HOME_DIR = home
}

const presetHomes: string[] = []
let homeBeforePreset: string | undefined
beforeEach(() => {
  homeBeforePreset = process.env.KOBE_HOME_DIR
})
afterEach(() => {
  if (homeBeforePreset === undefined) {
    // biome-ignore lint/performance/noDelete: the var must be truly unset when it started unset.
    delete process.env.KOBE_HOME_DIR
  } else process.env.KOBE_HOME_DIR = homeBeforePreset
  for (const home of presetHomes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe("set-effort", () => {
  /** A task.get responder — the verb reads the task to learn its engine. */
  const taskOf = (task: Record<string, unknown>) => ({ "task.get": () => ({ task: { id: "t1", ...task } }) })

  it("sends the level on task.setVendor once the task's engine declares it", async () => {
    const client = new FakeClient({ ...taskOf({ vendor: "codex" }), "task.setVendor": () => ({}) })
    const out = await invokeVerb("set-effort", ["--task-id", "t1", "--level", "xhigh"], {
      client,
      runtime: stubRuntime(),
    })
    expect(out).toEqual({ ok: true, taskId: "t1", engine: "codex", effort: "xhigh" })
    expect(client.requests.at(-1)).toEqual({
      name: "task.setVendor",
      payload: { taskId: "t1", vendor: "codex", effort: "xhigh" },
    })
  })

  it("resolves the engine from a PINNED command, not just the recorded vendor", async () => {
    // A task launched with `--command "codex --search"` is a codex launch;
    // reading `vendor` alone would judge the level against the wrong engine.
    const client = new FakeClient({
      ...taskOf({ vendor: "generic", command: "codex --search" }),
      "task.setVendor": () => ({}),
    })
    await invokeVerb("set-effort", ["--task-id", "t1", "--level", "high"], { client, runtime: stubRuntime() })
    expect(client.requests.at(-1)).toEqual({
      name: "task.setVendor",
      payload: { taskId: "t1", vendor: "codex", effort: "high" },
    })
  })

  it("refuses a level the engine does not declare, naming the ones it does", async () => {
    // The whole point of the verb: `withEngineEffort` DROPS an unknown
    // level at launch, so passing it through would look like success and
    // run at the default.
    const client = new FakeClient(taskOf({ vendor: "codex" }))
    await expectApiError(
      () => invokeVerb("set-effort", ["--task-id", "t1", "--level", "turbo"], { client, runtime: stubRuntime() }),
      "BAD_EFFORT",
      /none, low, medium, high, xhigh/,
    )
    expect(client.requests.map((r) => r.name)).toEqual(["task.get"])
  })

  it("refuses any level on an engine with no declared levels", async () => {
    const client = new FakeClient(taskOf({ vendor: "claude" }))
    await expectApiError(
      () => invokeVerb("set-effort", ["--task-id", "t1", "--level", "xhigh"], { client, runtime: stubRuntime() }),
      "BAD_EFFORT",
      /declares no reasoning effort levels/,
    )
    expect(client.requests.map((r) => r.name)).toEqual(["task.get"])
  })

  // A preset declaring the codex protocol IS a codex launch, and the TUI
  // records the preset id in `vendor`. Reading that id raw found the
  // registry's empty custom entry, so every level was refused — set-effort
  // could not set one at all on the tasks most likely to want one.
  it("accepts a level on a wrapped preset that declares the engine's protocol", async () => {
    withPreset()
    const client = new FakeClient({ ...taskOf({ vendor: "mycodex" }), "task.setVendor": () => ({}) })
    const out = await invokeVerb("set-effort", ["--task-id", "t1", "--level", "high"], {
      client,
      runtime: stubRuntime(),
    })
    expect(out).toEqual({ ok: true, taskId: "t1", engine: "codex", effort: "high" })
  })

  // Setting a level must not change WHICH engine the task says it is: the
  // footer labels a task from `engineName.<vendor>`, so rewriting `mycodex`
  // to `codex` silently dropped the user's own name for it.
  it("leaves a wrapped preset's own id on the task", async () => {
    withPreset()
    const client = new FakeClient({
      ...taskOf({ vendor: "mycodex", command: "codex" }),
      "task.setVendor": () => ({}),
    })
    await invokeVerb("set-effort", ["--task-id", "t1", "--level", "high"], { client, runtime: stubRuntime() })
    expect(client.requests.at(-1)).toEqual({
      name: "task.setVendor",
      payload: { taskId: "t1", vendor: "mycodex", effort: "high" },
    })
  })
})

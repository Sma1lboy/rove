/**
 * A contrib engine that declares a list verb and a model flag is pickable end
 * to end: `engine-list` carries its catalog, and `add --model` passes the gate
 * and reaches the launch argv. Antigravity (`agy models`) is the fixture.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { invokeVerb } from "@sma1lboy/rove-api/cli/api-cmd.ts"
import { withEngineModel } from "@sma1lboy/rove-core/engine/interactive-command.ts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FakeClient, openedTab, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

// The real `pi`/`omp` list verbs cost seconds on a machine that has them.
vi.mock("@sma1lboy/rove-core/engine/model-lists.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sma1lboy/rove-core/engine/model-lists.ts")>()),
  listPiModels: async () => [],
  listOmpModels: async () => [],
}))

const before = { PATH: process.env.PATH, ROVE_HOME_DIR: process.env.ROVE_HOME_DIR }
let dir = ""

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rove-contrib-models-"))
  // Real `agy models` shape: progress line on stderr, `id<TAB>label` on stdout.
  const agy = join(dir, "agy")
  writeFileSync(
    agy,
    `#!/bin/sh\n[ "$1" = models ] || exit 2\necho 'Fetching available models...' >&2\nprintf 'gemini-4-neon-high\\tGemini 4 Neon (High)\\n'\n`,
  )
  chmodSync(agy, 0o755)
  process.env.PATH = `${dir}:${before.PATH ?? ""}`
  process.env.ROVE_HOME_DIR = dir
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env.PATH = before.PATH
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  if (before.ROVE_HOME_DIR === undefined) delete process.env.ROVE_HOME_DIR
  else process.env.ROVE_HOME_DIR = before.ROVE_HOME_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe("contrib engine models", () => {
  it("engine-list carries the list verb's catalog", async () => {
    // Contrib discovery is `Bun.which`, absent under vitest's node.
    vi.stubGlobal("Bun", { which: (bin: string) => (bin === "agy" ? join(dir, "agy") : null) })
    const { engines } = (await invokeVerb("engine-list", [], { client: null, runtime: stubRuntime() })) as {
      engines: Array<{ id: string; models: unknown }>
    }
    expect(engines.find((e) => e.id === "antigravity")?.models).toEqual([
      { id: "gemini-4-neon-high", label: "Gemini 4 Neon (High)" },
    ])
  })

  it("add --model passes the gate and lands in the launch argv", async () => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await invokeVerb("add", ["--repo", "/repo/x", "--command", "agy", "--model", "gemini-4-neon-high", "--start"], {
      client,
      runtime: stubRuntime({ openTab: openedTab }),
    })
    expect(client.requests[0]?.payload).toMatchObject({ vendor: "antigravity", model: "gemini-4-neon-high" })
    expect(withEngineModel(["agy"], "antigravity", "gemini-4-neon-high")).toEqual([
      "agy",
      "--model",
      "gemini-4-neon-high",
    ])
  })
})

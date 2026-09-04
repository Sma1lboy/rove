/**
 * How TaskIndexStore reads a home that predates the `.kobe` → `.rove` rename.
 *
 * The seam against `store-load-edge.test.ts` is the input, not the assertion:
 * these fix the LAYOUT the manifest is found in, where the failure mode is
 * "the wrong file answered" rather than "this file's bytes are malformed".
 * Both directions matter and they pull against each other — an unmigrated home
 * must still be readable, and a migrated one must never fall back, or deleted
 * tasks come back from the frozen legacy copy.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"

let home: string
let store: TaskIndexStore

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "kobe-store-legacy-"))
  store = new TaskIndexStore({ homeDir: home })
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe("legacy .kobe layout", () => {
  it("reads the legacy index until migration and carries every legacy task into the first canonical save", async () => {
    const legacyPath = join(home, ".kobe", "tasks.json")
    await mkdir(join(home, ".kobe"), { recursive: true })
    const legacyTask = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      title: "legacy",
      repo: "/r",
      branch: "kobe/legacy",
      worktreePath: "/legacy/wt",
      status: "backlog",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    const legacyJson = JSON.stringify({ version: 3, tasks: [legacyTask] })
    await writeFile(legacyPath, legacyJson, "utf8")

    expect((await store.load()).tasks.map((task) => task.title)).toEqual(["legacy"])
    await store.create({
      repo: "/r",
      title: "new",
      branch: "rove/new",
      worktreePath: "/rove/wt",
      status: "backlog",
      kind: "task",
      vendor: "claude",
    })

    const canonical = JSON.parse(await readFile(store.filePath, "utf8")) as { tasks: Array<{ title: string }> }
    expect(canonical.tasks.map((task) => task.title)).toEqual(["legacy", "new"])
    expect(await readFile(legacyPath, "utf8")).toBe(legacyJson)
  })

  it("stops reading the legacy index once the daemon migration marker exists", async () => {
    // The migration copies .kobe/tasks.json across once; after that the legacy
    // file is a frozen snapshot. Settings › Reset UI state unlinks only the
    // canonical file, so an ungated fallback resurrects every pre-rename task.
    const legacyPath = join(home, ".kobe", "tasks.json")
    await mkdir(join(home, ".kobe"), { recursive: true })
    await writeFile(
      legacyPath,
      JSON.stringify({
        version: 3,
        tasks: [
          {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            title: "legacy",
            repo: "/r",
            branch: "",
            worktreePath: "",
            status: "backlog",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    )
    await mkdir(join(home, ".rove"), { recursive: true })
    await writeFile(join(home, ".rove", ".layout-daemon-migration-v1"), "", "utf8")

    expect((await store.load()).tasks).toEqual([])
    // …and the save path's fresh disk read is gated by the same marker, so the
    // legacy rows do not come back as "concurrent creates" on the next write.
    await store.create({
      repo: "/r",
      title: "new",
      branch: "",
      worktreePath: "",
      status: "backlog",
      kind: "task",
      vendor: "claude",
    })
    const canonical = JSON.parse(await readFile(store.filePath, "utf8")) as { tasks: Array<{ title: string }> }
    expect(canonical.tasks.map((task) => task.title)).toEqual(["new"])
  })
})

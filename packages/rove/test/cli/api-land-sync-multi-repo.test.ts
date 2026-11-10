/**
 * `land` / `sync` on a task that spans several repos: `--repo` narrows the run,
 * and a run that stopped partway is the usual error carrying each repo's status
 * so the caller sees what already landed.
 */

import { describe, expect, it } from "vitest"
import { ApiError, invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, stubRuntime } from "./api-handler-fixtures.ts"

const landed = { name: "web", status: "landed", landedOn: "main", commit: "abc1234" }

async function caught(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run()
  } catch (err) {
    if (err instanceof ApiError) return err
    throw err
  }
  throw new Error("expected the verb to throw")
}

describe("land on a multi-repo task", () => {
  it("sends --repo to the daemon, for the land and for the dry run", async () => {
    const client = new FakeClient({
      "task.land": () => ({
        result: { branch: "b", strategy: "merge", landedOn: "main", commit: "c", repos: [landed] },
      }),
      "task.landPreflight": () => ({ result: { branch: "b", landedOn: "main", baseDir: "/x" } }),
    })
    await invokeVerb("land", ["--task-id", "t1", "--repo", "api"], { client, runtime: stubRuntime() })
    await invokeVerb("land", ["--task-id", "t1", "--repo", "api", "--dry-run"], { client, runtime: stubRuntime() })
    expect(client.requests.map((r) => (r.payload as { repo?: string }).repo)).toEqual(["api", "api"])
  })

  it("raises a stop as the usual error, with every repo's status and the way to resume", async () => {
    const repos = [landed, { name: "api", status: "conflict", code: "LAND_CONFLICT" }]
    // As the daemon sends it: a failed request whose error carries the per-repo statuses.
    const client = new FakeClient({
      "task.land": () => {
        throw Object.assign(new Error("LAND_CONFLICT: merging 'b' hit conflicts — conflicted files: x"), {
          name: "LandStoppedError",
          data: { stopped: { repo: "api", code: "LAND_CONFLICT" }, repos },
        })
      },
    })

    const err = await caught(() => invokeVerb("land", ["--task-id", "t1"], { client, runtime: stubRuntime() }))

    expect(err.code).toBe("LAND_CONFLICT")
    expect(err.message).toBe("merging 'b' hit conflicts — conflicted files: x")
    expect(err.data).toMatchObject({ taskId: "t1", failedRepo: "api", repos })
    expect(String(err.data?.hint)).toContain("run `land` again")
  })

  it("reports a fully landed multi-repo run as a success carrying .repos", async () => {
    const client = new FakeClient({
      "task.land": () => ({
        result: { branch: "b", strategy: "merge", landedOn: "main", commit: "c", repos: [landed] },
      }),
    })

    const res = await invokeVerb("land", ["--task-id", "t1"], { client, runtime: stubRuntime() })

    expect(res).toMatchObject({ ok: true, taskId: "t1", repos: [landed] })
  })
})

describe("sync on a multi-repo task", () => {
  it("raises the first failing repo after all ran, naming it and keeping every repo's outcome", async () => {
    const repos = [
      { name: "web", ok: false, error: "SYNC_CONFLICT: a.txt", code: "SYNC_CONFLICT" },
      { name: "api", ok: true, baseRef: "main", alreadyCurrent: true },
    ]
    const client = new FakeClient({
      "task.syncBase": () => ({ result: { baseRef: "main", alreadyCurrent: false, repos } }),
    })

    const err = await caught(() => invokeVerb("sync", ["--task-id", "t1"], { client, runtime: stubRuntime() }))

    expect(err.code).toBe("SYNC_CONFLICT")
    expect(err.message).toBe("a.txt")
    expect(err.data).toMatchObject({ failedRepo: "web", repos })
  })

  it("returns the result when every repo synced, forwarding --repo", async () => {
    const client = new FakeClient({
      "task.syncBase": () => ({
        result: { baseRef: "main", alreadyCurrent: true, repos: [{ name: "api", ok: true }] },
      }),
    })

    const res = await invokeVerb("sync", ["--task-id", "t1", "--repo", "api"], { client, runtime: stubRuntime() })

    expect(res).toMatchObject({ ok: true, baseRef: "main" })
    expect(client.requests[0]?.payload).toEqual({ taskId: "t1", repo: "api" })
  })
})

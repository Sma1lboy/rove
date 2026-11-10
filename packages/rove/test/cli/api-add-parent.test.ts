/**
 * Where `add` hangs a new task: under the verified calling session, under
 * `--parent`, or nowhere. The daemon turns the requested parent into its
 * top-level ancestor (test/orchestrator/spawn-child.test.ts); what the CLI
 * owns is WHICH task it asks for and through which create RPC.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { type SelfSessionProbe, resetVerifiedSelfSession, verifiedSelfSession } from "../../src/cli/api/dispatcher.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const root = taskFixture({ id: "root", repo: "/work/web" })
const kid = taskFixture({ id: "kid", repo: "/work/web", parentTaskId: "root", sharesWorkspaceOf: "root" })
const elsewhere = taskFixture({ id: "api-task", repo: "/work/api" })

/** This process (pid 500) descends from `kid`'s tab shell, as a real `rove api` call inside the tab does. */
const kidProbe: SelfSessionProbe = {
  pid: 500,
  sessions: async () => [{ key: "kid::tab-1", pid: 100, alive: true }],
  ps: async () => ["  100     1 /bin/zsh -il", "  200   100 claude", "  500   200 bun rove api add"].join("\n"),
}
const asKid = () => verifiedSelfSession({ ROVE_TASK_ID: "kid", ROVE_TAB_ID: "tab-1" }, kidProbe)

function createClient(tasks: Record<string, unknown>[] = [root, kid], spawnTask?: Record<string, unknown>) {
  return new FakeClient({
    "task.list": () => ({ tasks }),
    "task.get": (payload) => {
      const taskId = payload && typeof payload === "object" && "taskId" in payload ? payload.taskId : undefined
      return { task: tasks.find((t) => t.id === taskId) }
    },
    "task.create": (_p, i) => ({ taskId: `c${i + 1}`, task: taskFixture({ id: `c${i + 1}` }) }),
    "task.spawn": (_p, i) => ({
      taskId: spawnTask ? String(spawnTask.id) : `s${i + 1}`,
      task: spawnTask ?? taskFixture({ id: `s${i + 1}` }),
      parentDirty: i === 0,
      sharedLinks: [],
    }),
    "task.setPrompt": () => ({}),
  })
}

const run = (client: FakeClient, argv: string[], deliver = recordingDelivery().deliver) =>
  invokeVerb("add", argv, { client, runtime: stubRuntime({ deliverPrompt: deliver }) })

beforeEach(() => {
  resetVerifiedSelfSession()
  Reflect.deleteProperty(process.env, "ROVE_TASK_ID")
  Reflect.deleteProperty(process.env, "ROVE_TAB_ID")
})
afterEach(resetVerifiedSelfSession)

describe("add from a verified rove session", () => {
  it("nests under the calling task, cuts from its tip, and still records the exact task and tab as dispatcher", async () => {
    await asKid()
    const client = createClient()

    const reply = (await run(client, ["--repo", "/work/web"])) as { parentDirty: boolean }

    const [spawn] = client.requests.filter((r) => r.name === "task.spawn")
    expect(client.requestNames).not.toContain("task.create")
    expect(spawn?.payload).toMatchObject({
      parentTaskId: "kid",
      worktree: true,
      lazy: true,
      dispatcherTaskId: "kid",
      dispatcherTabId: "tab-1",
    })
    expect(spawn?.payload).not.toHaveProperty("repo")
    expect(reply.parentDirty).toBe(true)
  })

  it("--no-parent stays top level", async () => {
    await asKid()
    const client = createClient()

    await run(client, ["--repo", "/work/web", "--no-parent"])

    const [create] = client.requests.filter((r) => r.name === "task.create")
    expect(client.requestNames).not.toContain("task.spawn")
    expect(create?.payload).not.toHaveProperty("parentTaskId")
    expect(create?.payload).toMatchObject({ dispatcherTaskId: "kid" })
  })

  it("stays top level when the caller's tree lives in another repo", async () => {
    await asKid()
    const client = createClient()

    await run(client, ["--repo", "/work/api"])

    const [create] = client.requests.filter((r) => r.name === "task.create")
    expect(create?.payload).not.toHaveProperty("parentTaskId")
  })

  it("stays top level under a routine session", async () => {
    await asKid()
    const client = createClient([{ ...root, routine: { id: "r1" } }, kid])

    await run(client, ["--repo", "/work/web"])

    expect(client.requestNames).not.toContain("task.spawn")
    expect(client.requests.find((r) => r.name === "task.create")?.payload).not.toHaveProperty("parentTaskId")
  })

  it("nests without cutting from the tip when --base-branch names the fork point", async () => {
    await asKid()
    const client = createClient()

    await run(client, ["--repo", "/work/web", "--base-branch", "release"])

    const [create] = client.requests.filter((r) => r.name === "task.create")
    expect(client.requestNames).not.toContain("task.spawn")
    expect(create?.payload).toMatchObject({ parentTaskId: "kid", baseRef: "release" })
  })

  it("nests a --workspace task through task.create, so its backend is not dropped by a cut from the tip", async () => {
    await asKid()
    const client = createClient()

    await run(client, ["--repo", "/work/web", "--workspace", "layerfs"])

    const [create] = client.requests.filter((r) => r.name === "task.create")
    expect(client.requestNames).not.toContain("task.spawn")
    expect(create?.payload).toMatchObject({ parentTaskId: "kid", workspace: "layerfs" })
  })

  it("gives every --count sibling the parent", async () => {
    await asKid()
    const client = createClient()

    await run(client, ["--repo", "/work/web", "--prompt", "go", "--count", "3"])

    const spawns = client.requests.filter((r) => r.name === "task.spawn")
    expect(spawns).toHaveLength(3)
    for (const spawn of spawns) expect(spawn.payload).toMatchObject({ parentTaskId: "kid", lazy: true })
  })
})

describe("add outside a verified session", () => {
  it("stays top level when the env does not verify, without reading the tree", async () => {
    process.env.ROVE_TASK_ID = "kid"
    const client = createClient()

    await run(client, ["--repo", "/work/web"])

    expect(client.requestNames).not.toContain("task.list")
    expect(client.requests.find((r) => r.name === "task.create")?.payload).not.toHaveProperty("parentTaskId")
  })

  it("--parent nests under that task, in any repo, without a session", async () => {
    const client = createClient([root, kid, elsewhere])

    await run(client, ["--repo", "/work/web", "--parent", "api-task"])

    const [create] = client.requests.filter((r) => r.name === "task.create")
    expect(create?.payload).toMatchObject({ parentTaskId: "api-task", repo: "/work/web" })
    expect(create?.payload).not.toHaveProperty("dispatcherTaskId")
  })

  it("--parent in the task's own repo cuts from that task's tip", async () => {
    const client = createClient()

    await run(client, ["--repo", "/work/web", "--parent", "root"])

    expect(client.requests.find((r) => r.name === "task.spawn")?.payload).toMatchObject({ parentTaskId: "root" })
  })

  it("--parent naming no task is PARENT_NOT_FOUND, with nothing created", async () => {
    const client = new FakeClient({
      "task.get": () => {
        throw new Error("task not found: ghost")
      },
    })

    await expectApiError(() => run(client, ["--repo", "/work/web", "--parent", "ghost"]), "PARENT_NOT_FOUND")
    expect(client.requestNames).toEqual(["task.get"])
  })
})

describe("add --no-worktree and --isolate-in", () => {
  it("--no-worktree shares the parent's directory instead of cutting one", async () => {
    const client = createClient()

    await run(client, ["--parent", "root", "--no-worktree"])

    const [spawn] = client.requests.filter((r) => r.name === "task.spawn")
    expect(spawn?.payload).toMatchObject({ parentTaskId: "root", worktree: false })
    expect(spawn?.payload).not.toHaveProperty("lazy")
  })

  it("--no-worktree takes the calling session as its parent, whatever the directory it runs from", async () => {
    await asKid()
    const client = createClient()

    await run(client, ["--no-worktree"])

    expect(client.requests.find((r) => r.name === "task.spawn")?.payload).toMatchObject({
      parentTaskId: "kid",
      worktree: false,
    })
  })

  it("--isolate-in rides the lazy worktree child to the daemon", async () => {
    const client = createClient()

    await run(client, ["--parent", "root", "--isolate-in", "shared-lib"])

    expect(client.requests.find((r) => r.name === "task.spawn")?.payload).toMatchObject({
      parentTaskId: "root",
      worktree: true,
      isolateIn: "shared-lib",
    })
  })

  it("--no-worktree without any parent is MISSING_TARGET", async () => {
    const client = createClient()

    await expectApiError(() => run(client, ["--no-worktree"]), "MISSING_TARGET", /--no-worktree needs a parent/)
    expect(client.requestNames).toEqual([])
  })

  it.each([
    [["--repo", "/work/web", "--parent", "root", "--no-parent"]],
    [["--parent", "root", "--no-worktree", "--no-parent"]],
    [["--parent", "root", "--no-worktree", "--isolate-in", "lib"]],
    [["--parent", "root", "--no-worktree", "--repo", "/work/web"]],
    [["--parent", "root", "--no-worktree", "--base-branch", "dev"]],
    [["--parent", "root", "--no-worktree", "--count", "2", "--prompt", "p"]],
    [["--parent", "root", "--isolate-in", "lib", "--fork", "root"]],
    [["--parent", "root", "--no-worktree", "--workspace", "layerfs"]],
  ])("%j conflicts before anything is created", async (argv) => {
    const client = createClient()

    await expectApiError(() => run(client, argv), "CONFLICTING_FLAGS")
    expect(client.requests).toEqual([])
  })
})

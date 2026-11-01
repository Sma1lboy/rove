/**
 * `add --repo A --repo B [--base-for REPO=REF]`: the first repo is the primary,
 * the rest ride `task.create` as `extraRepos` in pick order. The flag errors
 * name the offending repo before anything is created.
 */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const createClient = () => new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })

describe("add --repo (repeatable)", () => {
  it("sends the first repo as the primary and the rest as extraRepos, in pick order", async () => {
    const client = createClient()
    await invokeVerb("add", ["--repo", "/work/web", "--repo", "/work/api", "--repo", "/work/docs"], {
      client,
      runtime: stubRuntime(),
    })
    const [create] = client.requests.filter((r) => r.name === "task.create")
    expect(create?.payload).toMatchObject({
      repo: "/work/web",
      extraRepos: [{ repo: "/work/api" }, { repo: "/work/docs" }],
    })
  })

  it("keys --base-for on a path by git root, so a symlinked spelling of the repo still matches", async () => {
    const client = createClient()
    const canonical = (p: string) => p.replace(/^\/link\//, "/real/")
    await invokeVerb("add", ["--repo", "/link/web", "--repo", "/link/api", "--base-for", "/link/api=dev"], {
      client,
      runtime: stubRuntime({ resolveRepoRoot: async (p) => canonical(p) }),
    })
    const [create] = client.requests.filter((r) => r.name === "task.create")
    expect(create?.payload).toMatchObject({ extraRepos: [{ repo: "/real/api", baseRef: "dev" }] })
  })

  it("keys --base-for on the repo name and keeps --base-branch as the primary's base", async () => {
    const client = createClient()
    await invokeVerb(
      "add",
      ["--repo", "/work/web", "--repo", "/work/api", "--base-branch", "develop", "--base-for", "api=release/2"],
      { client, runtime: stubRuntime() },
    )
    const [create] = client.requests.filter((r) => r.name === "task.create")
    expect(create?.payload).toMatchObject({
      baseRef: "develop",
      extraRepos: [{ repo: "/work/api", baseRef: "release/2" }],
    })
  })

  it("gives every --count sibling the same repo set", async () => {
    const client = new FakeClient({
      "task.create": (_payload, index) => ({ taskId: `t${index + 1}`, task: taskFixture({ id: `t${index + 1}` }) }),
    })
    await invokeVerb("add", ["--repo", "/work/web", "--repo", "/work/api", "--prompt", "go", "--count", "2"], {
      client,
      runtime: stubRuntime({ deliverPrompt: recordingDelivery().deliver }),
    })
    const creates = client.requests.filter((r) => r.name === "task.create")
    expect(creates).toHaveLength(2)
    for (const create of creates) expect(create.payload).toMatchObject({ extraRepos: [{ repo: "/work/api" }] })
  })

  it("refuses more than 8 repos, a repeated root, a non-git extra and a remote extra without creating anything", async () => {
    const client = createClient()
    const run = (repos: string[], runtime = stubRuntime()) =>
      invokeVerb(
        "add",
        repos.flatMap((r) => ["--repo", r]),
        { client, runtime },
      )

    await expectApiError(() => run(Array.from({ length: 9 }, (_, i) => `/work/r${i}`)), "TOO_MANY_REPOS")
    await expectApiError(() => run(["/work/web", "/work/api", "/work/api"]), "REPO_DUPLICATE", /\/work\/api/)
    await expectApiError(
      () => run(["/work/web", "/work/plain"], stubRuntime({ isUsableRepo: async (p) => p !== "/work/plain" })),
      "NOT_A_GIT_REPO",
      /\/work\/plain/,
    )
    await expectApiError(() => run(["/work/web", "ssh://me@host/srv/api"]), "REMOTE_EXTRA_UNSUPPORTED")
    expect(client.requests).toEqual([])
  })

  it("refuses a --base-for that names no repo of the task or contradicts --base-branch", async () => {
    const client = createClient()
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", "/work/web", "--repo", "/work/api", "--base-for", "nope=x"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_FLAG",
      /no such repo.*web, api/,
    )
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", "/work/web", "--repo", "/work/api", "--base-branch", "a", "--base-for", "web=b"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_FLAG",
    )
    expect(client.requests).toEqual([])
  })
})

describe("launches of a task that shares a multi-repo owner's workspace", () => {
  const sharer = taskFixture({ id: "kid", parentTaskId: "abc", sharesWorkspaceOf: "abc" })

  it("send marks a cold launch to a shared child, whose own row has no extras, so the owner's repos are read", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: sharer }) })
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "kid", "--prompt", "hi"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(calls[0]?.target.multiRepo).toBe(true)
  })

  it("send leaves an ordinary one-repo task unmarked, so it costs no extra task.get", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ id: "abc" }) }) })
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "abc", "--prompt", "hi"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(calls[0]?.target.multiRepo).toBeUndefined()
  })

  it("add --no-worktree --prompt marks the child it launches", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc" }) }),
      "task.spawn": () => ({ taskId: "kid", task: sharer, parentDirty: false, sharedLinks: [] }),
      "task.setPrompt": () => ({}),
    })
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("add", ["--parent", "abc", "--no-worktree", "--prompt", "hi"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(calls[0]?.target).toMatchObject({ id: "kid", multiRepo: true })
  })
})

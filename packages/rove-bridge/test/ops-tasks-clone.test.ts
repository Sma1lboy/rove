import { describe, expect, test } from "bun:test"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import { TASK_OPS } from "../src/ops/tasks.ts"
import { fakeApi, isolateTaskOpDeps, refused, run } from "./task-ops-harness.ts"

isolateTaskOpDeps()

describe("repo.clone", () => {
  function fakeClone() {
    const seen: Array<[string, string]> = []
    taskOpDeps.cloneRepo = async (url, target) => {
      seen.push([url, target])
      return { ok: true, path: target }
    }
    taskOpDeps.validateCloneTarget = () => null
    taskOpDeps.findAvailableFolderName = (_p, base) => base
    return seen
  }

  test("clones into parentDir/<derived folder>", async () => {
    const seen = fakeClone()
    const { result } = await run("repo.clone", { url: "git@github.com:foo/bar.git", parentDir: "/work" })
    expect(seen).toEqual([["git@github.com:foo/bar.git", "/work/bar"]])
    expect(result).toEqual({ path: "/work/bar" })
    expect((await run("repo.clone", { url: "https://h/x/y", parentDir: "/work", folder: "z" })).result).toEqual({
      path: "/work/z",
    })
  })

  test("with no parentDir the clone goes to Rove's own repos dir, and one already there is reused", async () => {
    const seen = fakeClone()
    taskOpDeps.managedClone = () => ({ dir: "/home/.rove/repos/github.com/foo/bar", ready: false })
    const fresh = await run("repo.clone", { url: "git@github.com:foo/bar.git" })
    expect(fresh.result).toEqual({ path: "/home/.rove/repos/github.com/foo/bar" })
    taskOpDeps.managedClone = () => ({ dir: "/home/.rove/repos/github.com/foo/bar", ready: true })
    expect((await run("repo.clone", { url: "git@github.com:foo/bar.git" })).result).toEqual(fresh.result)
    expect(seen).toEqual([["git@github.com:foo/bar.git", "/home/.rove/repos/github.com/foo/bar"]])
  })

  test("git's output reaches the caller as progress lines, at most one per gap", async () => {
    taskOpDeps.cloneRepo = async (_url, target, onProgress) => {
      onProgress?.("Cloning into 'y'...")
      onProgress?.("Receiving objects: 10%")
      onProgress?.("Receiving objects: 20%")
      return { ok: true, path: target }
    }
    taskOpDeps.validateCloneTarget = () => null
    taskOpDeps.findAvailableFolderName = (_p, base) => base
    const { api } = fakeApi()
    const lines: string[] = []
    await TASK_OPS["repo.clone"]?.run(
      { url: "https://h/x/y", parentDir: "/work" },
      { api, progress: (l) => lines.push(l) },
    )
    expect(lines).toEqual(["Cloning into 'y'..."])
  })

  test("a failed clone surfaces git's message", async () => {
    taskOpDeps.cloneRepo = async () => ({ ok: false, error: "fatal: repository not found" })
    taskOpDeps.validateCloneTarget = () => null
    const { api } = fakeApi()
    await expect(
      TASK_OPS["repo.clone"]?.run({ url: "https://h/x/y", parentDir: "/work" }, { api }),
    ).rejects.toMatchObject({
      code: "CLONE_FAILED",
      message: "fatal: repository not found",
    })
  })

  test.each([
    { url: "-oProxyCommand=touch /tmp/x", parentDir: "/work" },
    { url: "--upload-pack=touch /tmp/x", parentDir: "/work" },
    { url: "ext::sh -c touch% /tmp/x", parentDir: "/work" },
    { url: "fd::17/foo", parentDir: "/work" },
    { url: "file:///etc", parentDir: "/work" },
    { url: "/etc/passwd", parentDir: "/work" },
    { url: "ssh://-oProxyCommand=x/y", parentDir: "/work" },
    { url: "ssh://user@-host/y", parentDir: "/work" },
    { url: "-x@host:path", parentDir: "/work" },
    { url: "https://h/x y", parentDir: "/work" },
    { url: "ftp://h/x", parentDir: "/work" },
    { url: "", parentDir: "/work" },
    { url: 5, parentDir: "/work" },
    { url: "https://h/x/y", parentDir: "rel" },
    { url: "https://h/x/y", parentDir: "~/code" },
    { url: "https://h/x/y", parentDir: "/work", folder: "../evil" },
    { url: "https://h/x/y", parentDir: "/work", folder: "a/b" },
    { url: "https://h/x/y", parentDir: "/work", folder: ".." },
    { url: "https://h/x/y", parentDir: "/work", folder: "-rf" },
  ] as Record<string, unknown>[])("refuses %j without cloning", async (args) => {
    const seen = fakeClone()
    await refused("repo.clone", args)
    expect(seen).toEqual([])
  })

  test.each(["https://h/a/b.git", "http://h/a/b", "ssh://git@h:22/a/b", "git://h/a/b", "git@h:a/b.git"])(
    "accepts the transport of %s",
    async (url) => {
      const seen = fakeClone()
      await run("repo.clone", { url, parentDir: "/work" })
      expect(seen.map(([u]) => u)).toEqual([url])
    },
  )

  describe("owner/repo shorthand", () => {
    function ghConfig(protocol: string | null) {
      taskOpDeps.gh = async () =>
        protocol === null ? { ok: false, reason: "missing" } : { ok: true, stdout: `${protocol}\n` }
    }

    test.each([
      ["https", "https://github.com/octocat/Hello-World.git"],
      [null, "https://github.com/octocat/Hello-World.git"],
      ["ssh", "git@github.com:octocat/Hello-World.git"],
    ] as [string | null, string][])("gh protocol %p clones from %s", async (protocol, url) => {
      const seen = fakeClone()
      ghConfig(protocol)
      await run("repo.clone", { url: "octocat/Hello-World", parentDir: "/work" })
      expect(seen).toEqual([[url, "/work/Hello-World"]])
    })

    test("a .git suffix is not doubled, and dot-only names are refused", async () => {
      const seen = fakeClone()
      ghConfig("https")
      await run("repo.clone", { url: "o/r.git", parentDir: "/work" })
      expect(seen[0]?.[0]).toBe("https://github.com/o/r.git")
      await refused("repo.clone", { url: "o/..", parentDir: "/work" })
      await refused("repo.clone", { url: "a/b/c", parentDir: "/work" })
    })
  })
})

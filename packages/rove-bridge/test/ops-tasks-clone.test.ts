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

  test("git's output reaches the caller as progress lines, at most one per gap", async () => {
    taskOpDeps.cloneRepo = async (_url, target, onProgress) => {
      for (const line of ["Cloning into 'y'...", "Receiving objects: 10%", "Receiving objects: 20%"]) onProgress?.(line)
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

  test("refuses option-shaped, helper-transport, local and malformed urls and folders without cloning", async () => {
    const seen = fakeClone()
    const bad: Array<Record<string, unknown>> = [
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
    ]
    for (const args of bad) await refused("repo.clone", args)
    expect(seen).toEqual([])
  })

  test("accepts each allowed transport", async () => {
    const seen = fakeClone()
    for (const url of ["https://h/a/b.git", "http://h/a/b", "ssh://git@h:22/a/b", "git://h/a/b", "git@h:a/b.git"]) {
      await run("repo.clone", { url, parentDir: "/work" })
    }
    expect(seen.map(([u]) => u)).toHaveLength(5)
  })

  describe("owner/repo shorthand", () => {
    function ghConfig(protocol: string | null) {
      taskOpDeps.gh = async () =>
        protocol === null ? { ok: false, reason: "missing" } : { ok: true, stdout: `${protocol}\n` }
    }

    test("clones over https unless gh is set to ssh, and https when gh is absent", async () => {
      const seen = fakeClone()
      for (const protocol of ["https", null, "ssh"]) {
        ghConfig(protocol)
        await run("repo.clone", { url: "octocat/Hello-World", parentDir: "/work" })
      }
      expect(seen).toEqual([
        ["https://github.com/octocat/Hello-World.git", "/work/Hello-World"],
        ["https://github.com/octocat/Hello-World.git", "/work/Hello-World"],
        ["git@github.com:octocat/Hello-World.git", "/work/Hello-World"],
      ])
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

/**
 * `readReviewComments` through a REAL spawn of a fake `gh` on PATH, so the
 * argv GitHub needs and the "gh could not answer" path are both pinned.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MAX_THREADS, readReviewComments } from "@sma1lboy/rove-daemon/daemon/pr-review-comments"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

function thread(over: Record<string, unknown> = {}) {
  return {
    isResolved: false,
    isOutdated: false,
    path: "src/a.ts",
    line: 12,
    originalLine: 10,
    comments: { nodes: [{ author: { login: "reviewer" }, body: "rename this", url: "https://example.test/c1" }] },
    ...over,
  }
}

function graphql(threads: unknown[]) {
  return { data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } } }
}

describe("readReviewComments", () => {
  let binDir: string
  let cwd: string
  let previousPath: string | undefined

  function fakeGh(script: string) {
    writeFileSync(join(binDir, "gh"), `#!/bin/sh\n${script}\n`, { mode: 0o755 })
  }

  function answer(payload: unknown) {
    writeFileSync(join(binDir, "answer.json"), JSON.stringify(payload))
    fakeGh(`printf '%s\\n' "$@" > "${join(binDir, "argv")}"\ncat "${join(binDir, "answer.json")}"`)
  }

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "rove-fake-gh-"))
    cwd = mkdtempSync(join(tmpdir(), "rove-gh-cwd-"))
    previousPath = process.env.PATH
    process.env.PATH = `${binDir}:${previousPath ?? ""}`
  })

  afterEach(() => {
    process.env.PATH = previousPath ?? ""
    rmSync(binDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  it("asks GitHub for the PR's review threads in the worktree's repo", async () => {
    answer(graphql([]))
    await readReviewComments({ worktreePath: cwd, prNumber: 42 })
    const argv = readFileSync(join(binDir, "argv"), "utf8").split("\n")
    expect(argv.slice(0, 8)).toEqual(["api", "graphql", "-F", "owner={owner}", "-F", "repo={repo}", "-F", "number=42"])
  })

  it("keeps unresolved threads only, with their line, falling back to the original once outdated", async () => {
    answer(
      graphql([
        thread(),
        thread({ isResolved: true, path: "src/done.ts" }),
        thread({ isOutdated: true, line: null, path: "src/b.ts" }),
        thread({
          path: "README.md",
          line: null,
          originalLine: null,
          comments: { nodes: [{ author: null, body: "x" }] },
        }),
      ]),
    )
    const res = await readReviewComments({ worktreePath: cwd, prNumber: 1 })
    expect(res.unavailable).toBeUndefined()
    expect(res.totalUnresolved).toBe(3)
    expect(res.threads).toEqual([
      {
        path: "src/a.ts",
        line: 12,
        outdated: false,
        comments: [{ author: "reviewer", body: "rename this", url: "https://example.test/c1" }],
      },
      {
        path: "src/b.ts",
        line: 10,
        outdated: true,
        comments: [{ author: "reviewer", body: "rename this", url: "https://example.test/c1" }],
      },
      { path: "README.md", line: null, outdated: false, comments: [{ author: "ghost", body: "x", url: "" }] },
    ])
  })

  it("caps the threads it returns but counts them all", async () => {
    answer(graphql(Array.from({ length: MAX_THREADS + 5 }, (_, i) => thread({ line: i + 1 }))))
    const res = await readReviewComments({ worktreePath: cwd, prNumber: 1 })
    expect(res.threads).toHaveLength(MAX_THREADS)
    expect(res.totalUnresolved).toBe(MAX_THREADS + 5)
  })

  it("says gh failed, and quotes it, instead of reading as no open threads", async () => {
    fakeGh('echo "gh: To get started with GitHub CLI, please run: gh auth login" >&2\nexit 4')
    const res = await readReviewComments({ worktreePath: cwd, prNumber: 7 })
    expect(res.threads).toEqual([])
    expect(res.unavailable?.reason).toBe("gh_failed")
    expect(res.unavailable?.detail).toContain("gh auth login")
  })
})

/**
 * `readReviewComments` through a REAL spawn of a fake `gh` on PATH, so the
 * argv GitHub needs and the "gh could not answer" path are both pinned.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { MAX_THREADS, readReviewComments } from "@sma1lboy/rove-daemon/daemon/pr-review-comments"
import { frameToLine } from "@sma1lboy/rove-daemon/daemon/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

function graphql(threads: unknown[], endCursor: string | null = null) {
  return {
    data: {
      repository: {
        pullRequest: { reviewThreads: { nodes: threads, pageInfo: { hasNextPage: endCursor !== null, endCursor } } },
      },
    },
  }
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

  function pages(first: unknown, next: unknown, cursor: string, fail = false) {
    writeFileSync(join(binDir, "first.json"), JSON.stringify(first))
    writeFileSync(join(binDir, "next.json"), JSON.stringify(next))
    fakeGh(`
for arg in "$@"; do
  if [ "$arg" = "cursor=${cursor}" ]; then
    ${fail ? 'echo "page unavailable" >&2; exit 1' : `cat "${join(binDir, "next.json")}"; exit 0`}
  fi
done
cat "${join(binDir, "first.json")}"
`)
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

  it("delivers paginated feedback beyond the default deadline without disconnecting", async () => {
    vi.stubEnv("ROVE_RPC_TIMEOUT_MS", undefined)
    for (const [name, cursor] of [
      ["first", "second"],
      ["second", "third"],
      ["third", null],
    ] as const) {
      writeFileSync(join(binDir, `${name}.json`), JSON.stringify(graphql([thread({ path: name })], cursor)))
    }
    fakeGh(`
sleep 7
for arg in "$@"; do
  case "$arg" in
    cursor=second) cat "${join(binDir, "second.json")}"; exit 0;;
    cursor=third) cat "${join(binDir, "third.json")}"; exit 0;;
  esac
done
cat "${join(binDir, "first.json")}"
`)
    const socketPath = join(cwd, "daemon.sock")
    let completed: Promise<void> = Promise.resolve()
    let connections = 0
    const server = createServer((socket) => {
      connections++
      let buffer = ""
      socket.on("data", (data) => {
        buffer += data.toString()
        const newline = buffer.indexOf("\n")
        if (newline < 0) return
        const request = JSON.parse(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        completed = (async () => {
          const result = await readReviewComments({ worktreePath: cwd, prNumber: 42 })
          if (socket.destroyed) return
          socket.write(frameToLine({ type: "event", name: "active-task", payload: { taskId: "t1" } }))
          socket.write(frameToLine({ type: "response", id: request.id, payload: result }))
        })()
      })
    })
    const client = new RoveDaemonClient(socketPath)
    let closes = 0
    let activeTask: unknown
    client.onLifecycle("close", () => closes++)
    client.on("active-task", (frame) => {
      activeTask = frame.payload
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(socketPath, resolve)
      })
      const started = Date.now()
      await expect(client.request("pr.reviewComments", { taskId: "t1" })).resolves.toEqual({
        threads: ["first", "second", "third"].map((path) => ({
          path,
          line: 12,
          outdated: false,
          comments: [{ author: "reviewer", body: "rename this", url: "https://example.test/c1" }],
        })),
        totalUnresolved: 3,
      })
      expect(Date.now() - started).toBeGreaterThan(20_000)
      expect(closes).toBe(0)
      expect(connections).toBe(1)
      expect(activeTask).toEqual({ taskId: "t1" })
    } finally {
      client.close()
      await completed
      await new Promise<void>((resolve) => server.close(() => resolve()))
      vi.unstubAllEnvs()
    }
  }, 30_000)

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

  it("finds unresolved feedback after 100 resolved threads", async () => {
    pages(
      graphql(
        Array.from({ length: 100 }, () => thread({ isResolved: true })),
        "threads-100",
      ),
      graphql([thread()]),
      "threads-100",
    )
    const res = await readReviewComments({ worktreePath: cwd, prNumber: 1 })
    expect(res.totalUnresolved).toBe(1)
    expect(res.threads).toHaveLength(1)
    expect(res.unavailable).toBeUndefined()
  })

  it("counts unresolved threads across pages while retaining only the first 50", async () => {
    pages(
      graphql(
        Array.from({ length: 100 }, (_, i) => thread({ line: i + 1 })),
        "threads-100",
      ),
      graphql([thread({ line: 101 })]),
      "threads-100",
    )
    const res = await readReviewComments({ worktreePath: cwd, prNumber: 1 })
    expect(res.totalUnresolved).toBe(101)
    expect(res.threads.map((t) => t.line)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
  })

  it("includes the final reply after the first 20 comments", async () => {
    const comments = Array.from({ length: 20 }, (_, i) => ({ body: `comment ${i + 1}` }))
    pages(
      graphql([
        thread({
          id: "thread-1",
          comments: { nodes: comments, pageInfo: { hasNextPage: true, endCursor: "comments-20" } },
        }),
      ]),
      {
        data: {
          node: {
            comments: { nodes: [{ body: "final instructions" }], pageInfo: { hasNextPage: false, endCursor: null } },
          },
        },
      },
      "comments-20",
    )
    const res = await readReviewComments({ worktreePath: cwd, prNumber: 1 })
    expect(res.unavailable).toBeUndefined()
    expect(res.threads[0]?.comments.map((c) => c.body)).toEqual([...comments.map((c) => c.body), "final instructions"])
  })

  it.each(["threads", "comments"])("reports unavailable when a later %s page fails", async (kind) => {
    const first =
      kind === "threads"
        ? graphql([thread()], "next")
        : graphql([
            thread({ id: "thread-1", comments: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "next" } } }),
          ])
    pages(first, {}, "next", true)
    const res = await readReviewComments({ worktreePath: cwd, prNumber: 1 })
    expect(res.threads).toEqual([])
    expect(res.unavailable).toEqual({ reason: "gh_failed", detail: expect.stringContaining("page unavailable") })
  })

  it("says gh failed, and quotes it, instead of reading as no open threads", async () => {
    fakeGh('echo "gh: To get started with GitHub CLI, please run: gh auth login" >&2\nexit 4')
    const res = await readReviewComments({ worktreePath: cwd, prNumber: 7 })
    expect(res.threads).toEqual([])
    expect(res.unavailable?.reason).toBe("gh_failed")
    expect(res.unavailable?.detail).toContain("gh auth login")
  })
})

import { describe, expect, it } from "vitest"
import { createSpecFetcher } from "../pty-spec.mjs"

/**
 * The daemon hop the sidecar takes to turn a task into a launch spec.
 *
 * Every runner that touches `pty-server.mjs` sets `KOBE_PTY_DEV_COMMAND`, so
 * `bun run visual`, the hero captures and CI's visual gate all return before
 * this code — a web terminal broken from 0.9.60 to 0.9.102 passed ~40 CI runs
 * on that gap. `pty-session-lifecycle.test.ts` injects its own `fetchSpec`, so
 * it covers the manager, not the route choice, the bearer header, or the error
 * shaping. These cases drive the real branch with an injected `fetch`.
 */

type Call = { url: string; init: RequestInit | undefined }

/** A `fetch` that records the request and answers with a fixed response. */
function stubDaemon(status: number, body: unknown): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const SPEC = { cwd: "/repo/wt", command: ["claude"] }

describe("createSpecFetcher", () => {
  it("asks the engine route in engine mode and the terminal route in shell mode", async () => {
    const { fetchImpl, calls } = stubDaemon(200, SPEC)
    const fetchSpec = createSpecFetcher({ port: 45174, readToken: () => "tok", env: {}, fetchImpl })

    await fetchSpec("task-1", "engine")
    await fetchSpec("task-1", "shell")

    expect(calls[0]?.url).toBe("http://localhost:45174/api/engine-spec?taskId=task-1")
    expect(calls[1]?.url).toBe("http://localhost:45174/api/terminal-spec?taskId=task-1")
  })

  it("carries the bearer token — without it a real tab dies unauthorized before any PTY spawns", async () => {
    const { fetchImpl, calls } = stubDaemon(200, SPEC)
    const fetchSpec = createSpecFetcher({ port: 45174, readToken: () => "tok-abc", env: {}, fetchImpl })

    await expect(fetchSpec("task-1", "engine")).resolves.toEqual(SPEC)

    expect(calls[0]?.init?.headers).toEqual({ authorization: "Bearer tok-abc" })
  })

  it("sends no authorization header when there is no token yet", async () => {
    // The daemon mints the token file asynchronously; an empty read must not
    // become `Bearer ` (which the gate would reject with a different error).
    const { fetchImpl, calls } = stubDaemon(200, SPEC)
    const fetchSpec = createSpecFetcher({ port: 45174, readToken: () => "", env: {}, fetchImpl })

    await fetchSpec("task-1", "engine")

    expect(calls[0]?.init?.headers).toEqual({})
  })

  it("re-reads the token per call, so a file minted after startup is picked up", async () => {
    const { fetchImpl, calls } = stubDaemon(200, SPEC)
    let token = ""
    const fetchSpec = createSpecFetcher({ port: 45174, readToken: () => token, env: {}, fetchImpl })

    await fetchSpec("task-1", "engine")
    token = "late"
    await fetchSpec("task-1", "engine")

    expect(calls[0]?.init?.headers).toEqual({})
    expect(calls[1]?.init?.headers).toEqual({ authorization: "Bearer late" })
  })

  it("percent-encodes the task id rather than splicing it into the query", async () => {
    const { fetchImpl, calls } = stubDaemon(200, SPEC)
    const fetchSpec = createSpecFetcher({ port: 45174, readToken: () => "tok", env: {}, fetchImpl })

    await fetchSpec("task/1&mode=shell", "engine")

    expect(calls[0]?.url).toBe("http://localhost:45174/api/engine-spec?taskId=task%2F1%26mode%3Dshell")
  })

  it("throws the daemon's own message when the body carries one", async () => {
    const { fetchImpl } = stubDaemon(200, { error: "task has no worktree" })
    const fetchSpec = createSpecFetcher({ port: 45174, readToken: () => "tok", env: {}, fetchImpl })

    await expect(fetchSpec("task-1", "engine")).rejects.toThrow("task has no worktree")
  })

  it("falls back to the status form when a failing response says nothing", async () => {
    const { fetchImpl } = stubDaemon(401, {})
    const fetchSpec = createSpecFetcher({ port: 45174, readToken: () => "", env: {}, fetchImpl })

    await expect(fetchSpec("task-1", "engine")).rejects.toThrow("engine-spec failed (401)")
  })

  it("takes the harness override before the daemon is consulted at all", async () => {
    const { fetchImpl, calls } = stubDaemon(200, SPEC)
    const fetchSpec = createSpecFetcher({
      port: 45174,
      readToken: () => "tok",
      env: { KOBE_PTY_DEV_COMMAND: "bun run dev:mock", KOBE_PTY_DEV_CWD: "/tmp/fixture" },
      fetchImpl,
    })

    expect(await fetchSpec("task-1", "engine")).toEqual({
      cwd: "/tmp/fixture",
      command: ["/bin/sh", "-lc", "bun run dev:mock"],
    })
    expect(calls).toHaveLength(0)
  })
})

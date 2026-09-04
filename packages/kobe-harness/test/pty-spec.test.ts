import { describe, expect, it } from "vitest"
import { createSpecFetcher } from "../pty-spec.mjs"

/**
 * How the sidecar turns a task into a launch spec.
 *
 * Since #855 removed the daemon's HTTP transport there is one source —
 * `KOBE_PTY_DEV_COMMAND` — so these cases cover the override and the failure
 * shape when it is absent. `pty-session-lifecycle.test.ts` injects its own
 * `fetchSpec`, so it covers the manager, not this resolution.
 */

describe("createSpecFetcher", () => {
  it("builds the command from the harness override", async () => {
    const fetchSpec = createSpecFetcher({
      env: { KOBE_PTY_DEV_COMMAND: "bun run dev:mock", KOBE_PTY_DEV_CWD: "/tmp/fixture" },
    })

    expect(await fetchSpec("task-1", "engine")).toEqual({
      cwd: "/tmp/fixture",
      command: ["/bin/sh", "-lc", "bun run dev:mock"],
    })
  })

  it("resolves the same spec in shell mode — mode no longer selects a route", async () => {
    const fetchSpec = createSpecFetcher({ env: { KOBE_PTY_DEV_COMMAND: "bun run dev:mock", KOBE_PTY_DEV_CWD: "/tmp/f" } })

    expect(await fetchSpec("task-1", "shell")).toEqual(await fetchSpec("task-1", "engine"))
  })

  it("falls back to the process cwd when no override cwd is set", async () => {
    const fetchSpec = createSpecFetcher({ env: { KOBE_PTY_DEV_COMMAND: "bun run dev:mock" } })

    expect((await fetchSpec("task-1", "engine")).cwd).toBe(process.cwd())
  })

  it("throws naming the variable when it is unset, rather than resolving undefined", async () => {
    // A silent `undefined` would surface as a TypeError deep in
    // pty-session-lifecycle and present as a blank terminal with no cause.
    const fetchSpec = createSpecFetcher({ env: {} })

    await expect(fetchSpec("task-1", "engine")).rejects.toThrow("KOBE_PTY_DEV_COMMAND is unset")
  })
})

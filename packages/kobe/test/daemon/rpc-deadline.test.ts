import { BLOCKING_RPCS, type DaemonRequestName } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { blockingRpcNames, createDaemonHandlerRegistry } from "@sma1lboy/kobe-daemon/daemon/server"
import { describe, expect, it } from "vitest"

/**
 * The client's per-request deadline table.
 *
 * WHY this matters: the socket client rejects an over-deadline request with
 * `RpcTimeoutError("… daemon wedged?")`, then force-disconnects AND emits a
 * lifecycle "close" — on the TUI's long-lived connection that drops every
 * channel subscription. Applying that to a verb whose contract is to block
 * (a `task.land` on a large repo, a `ui.prompt` waiting on a human) puts the
 * whole workspace into the reconnect path while the daemon is healthy, and
 * reports it as a wedge.
 *
 * The set is declared twice on purpose: `protocol.ts` is the copy the client
 * reads (it cannot import this registry — that would pull every daemon module
 * into the CLI), the registry entry is where a verb declares itself. This file
 * is the join that keeps them from drifting.
 */

/** Every verb that may outlive the 20s default, pinned EXACTLY. */
const BLOCKING: readonly DaemonRequestName[] = [
  "ui.prompt",
  "task.land",
  "workitem.start",
  "automation.runNow",
  "task.ensureWorktree",
  "task.ensureMain",
  "worktree.discoverAdoptable",
  "worktree.adopt",
  "worktree.list",
  "worktree.remove",
]

describe("rpc deadline policy", () => {
  it("exempts exactly the pinned blocking surface", () => {
    expect([...BLOCKING_RPCS].sort()).toEqual([...BLOCKING].sort())
  })

  it("matches what the handler registry declares", () => {
    // The drift guard. Marking a handler `blocking: true` without adding it to
    // protocol.ts leaves it dying at 20s; the reverse silently disables the
    // wedge detector for a verb that should have it.
    expect([...blockingRpcNames(createDaemonHandlerRegistry())].sort()).toEqual([...BLOCKING_RPCS].sort())
  })

  it("keeps the interactive write surface on the deadline", () => {
    // These answer in milliseconds. Losing the wedge detector on them is how a
    // hung daemon turns into a silently frozen UI on stale state.
    for (const name of [
      "task.create",
      "task.rename",
      "task.delete",
      "task.status",
      "task.list",
      "daemon.status",
    ] as const) {
      expect(BLOCKING_RPCS.has(name), name).toBe(false)
    }
  })
})

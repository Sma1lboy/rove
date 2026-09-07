/**
 * `issue.snapshot` publishes only when somebody is subscribed.
 *
 * The channel has no in-repo consumer — the browser Issues pane was deleted
 * in #855 and the TUI kanban uses the `issue.list` / `issue.mutate` RPCs — but
 * it is a public plugin API, so it cannot be removed. Every task delete, every
 * task→done transition and every issue edit was therefore serializing a repo's
 * WHOLE issue state for nobody. `channels.ts` named this gate as the fix.
 *
 * The two directions matter differently: a gate that fails open costs one
 * wasted publish, a gate that fails closed silently drops a plugin's events.
 * So "no answer available" must publish, and only an explicit `false` may
 * suppress.
 */

import type { DaemonHandlerContext } from "@sma1lboy/kobe-daemon/daemon/server"
import { describe, expect, it } from "vitest"
import { dispatch, fakeCtx } from "./handler-test-context.ts"

/** Overwrite the context's `daemon.hasSubscribersFor` with a fixed answer. */
function withSubscribers(ctx: DaemonHandlerContext, answer: boolean | undefined): DaemonHandlerContext {
  return {
    ...ctx,
    daemon: { ...ctx.daemon, ...(answer === undefined ? {} : { hasSubscribersFor: () => answer }) },
  }
}

const MUTATE = { repoRoot: "/repo", op: { type: "create", title: "t" } }

async function snapshotsPublished(answer: boolean | undefined): Promise<number> {
  const { ctx, rec } = fakeCtx()
  await dispatch("issue.mutate", MUTATE, withSubscribers(ctx, answer))
  return rec.published.filter((p) => p.channel === "issue.snapshot").length
}

describe("issue.snapshot publish gate", () => {
  it("publishes when a subscriber is attached", async () => {
    expect(await snapshotsPublished(true)).toBe(1)
  })

  it("skips the publish when nobody is subscribed", async () => {
    expect(await snapshotsPublished(false)).toBe(0)
  })

  it("publishes when the daemon cannot answer at all (older contexts)", async () => {
    // `hasSubscribersFor` is optional; its absence must NOT be read as "no
    // subscribers" — that would suppress a plugin's events on any host that
    // does not supply it.
    expect(await snapshotsPublished(undefined)).toBe(1)
  })

  it("still returns the snapshot to the CALLER when the publish is skipped", async () => {
    // Gating the broadcast must not gate the RPC result — the caller asked
    // for this state directly and always gets it.
    const { ctx } = fakeCtx()
    const result = await dispatch("issue.mutate", MUTATE, withSubscribers(ctx, false))
    expect(result).toMatchObject({ repoRoot: "/repo" })
  })
})

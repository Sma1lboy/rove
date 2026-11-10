/** A standing session already holds the routine's prompt: later runs send only the header, until it could have lost or outdated it. */

import { describe, expect, it } from "vitest"
import { runAutomationOnce } from "../../../rove-daemon/src/daemon/automation-runner.ts"
import type { AutomationsStore } from "../../../rove-daemon/src/daemon/automations-store.ts"
import { FULL_PROMPT_EVERY_RUNS } from "../../../rove-daemon/src/daemon/routine-prompt.ts"
import { NOW, REPO, automation, fakeDeps, tempStore } from "./automation-runner-fixtures.ts"
import { dispatch, fakeCtx } from "./handler-test-context.ts"

const STANDING_TASK = { id: "standing", repo: REPO, worktreePath: REPO } as never
const UNCHANGED = "Instructions unchanged from this routine's earlier run"

async function fire(store: AutomationsStore, deps: ReturnType<typeof fakeDeps>["deps"], id: string) {
  await runAutomationOnce(deps, store.get(id)!, { scheduledFor: NOW, trigger: "manual" })
}

describe("standing-session prompt elision", () => {
  it("sends the full prompt on the first run and after an edit, the header alone otherwise", async () => {
    const store = await tempStore()
    const f = fakeDeps({ store, tasks: { standing: STANDING_TASK } })
    const a = await store.create(automation({ persistentSession: true, sessionTaskId: "standing" }))

    await fire(store, f.deps, a.id)
    await fire(store, f.deps, a.id)
    await store.update(a.id, { prompt: "run the audit, then the lint" })
    await fire(store, f.deps, a.id)

    expect(f.delivered[0]?.endsWith("\n\nrun the audit")).toBe(true)
    expect(f.delivered[1]).toContain(UNCHANGED)
    expect(f.delivered[1]).not.toContain("run the audit")
    expect(f.delivered[1]).toContain(" run #2 ")
    expect(f.delivered[2]?.endsWith("\n\nrun the audit, then the lint")).toBe(true)
  })

  it("a revived engine gets the full prompt, under the one delivery armed for the run", async () => {
    const store = await tempStore()
    let live = true
    const f = fakeDeps({
      store,
      tasks: { standing: STANDING_TASK },
      deliver: async () => (live ? { outcome: "delivered", tabId: "tab-1" } : { outcome: "no-session" }),
    })
    const a = await store.create(automation({ persistentSession: true, sessionTaskId: "standing" }))
    await fire(store, f.deps, a.id)
    live = false
    await fire(store, f.deps, a.id)

    expect(store.runsFor(a.id)[0]?.status).toBe("revived")
    expect(f.prompts).toHaveLength(1)
    expect(f.prompts[0]?.endsWith("\n\nrun the audit")).toBe(true)
    expect(f.deliveries.armed).toHaveLength(2)
  })

  it("after the session's tab reports a compaction, the next run is full and the one after is elided again", async () => {
    const store = await tempStore()
    const f = fakeDeps({ store, tasks: { standing: STANDING_TASK } })
    const { ctx } = fakeCtx()
    Object.assign(ctx, { automations: store })
    const a = await store.create(automation({ persistentSession: true, sessionTaskId: "standing" }))

    await fire(store, f.deps, a.id)
    await fire(store, f.deps, a.id)
    await dispatch("engine.reportEvent", { taskId: "standing", tabId: "tab-1", kind: "post-compact" }, ctx)
    await fire(store, f.deps, a.id)
    await fire(store, f.deps, a.id)

    expect(f.delivered.map((p) => p.endsWith("\n\nrun the audit"))).toEqual([true, false, true, false])
  })

  it(`resends the full prompt every ${FULL_PROMPT_EVERY_RUNS}th run even with no compaction report`, async () => {
    const store = await tempStore()
    const f = fakeDeps({ store, tasks: { standing: STANDING_TASK } })
    const a = await store.create(automation({ persistentSession: true, sessionTaskId: "standing" }))
    for (let run = 0; run <= FULL_PROMPT_EVERY_RUNS; run += 1) await fire(store, f.deps, a.id)
    const full = f.delivered.flatMap((p, i) => (p.endsWith("\n\nrun the audit") ? [i] : []))
    expect(full).toEqual([0, FULL_PROMPT_EVERY_RUNS])
  })

  it("a routine without a standing session gets the full prompt every run", async () => {
    const store = await tempStore()
    const f = fakeDeps({ store })
    const a = await store.create(automation())
    await fire(store, f.deps, a.id)
    await fire(store, f.deps, a.id)
    expect(f.prompts.map((p) => p.endsWith("\n\nrun the audit"))).toEqual([true, true])
  })
})

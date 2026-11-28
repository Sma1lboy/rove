import { createHmac } from "node:crypto"
import {
  dispatchAutomationEvent,
  extractPrTriggerEvents,
  hasPrEventRoutine,
  startAutomationEventWatcher,
  webhookMatchesTriggers,
} from "@sma1lboy/rove-daemon/daemon/automation-events"
import { dueAutomations, sweepAutomations } from "@sma1lboy/rove-daemon/daemon/automation-runner"
import { readWebhookEvent } from "@sma1lboy/rove-daemon/daemon/automation-webhook"
import { type Automation, type DaemonTask, automationTriggerMode } from "@sma1lboy/rove-daemon/daemon/contracts"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import { AUTOMATION_HANDLERS } from "@sma1lboy/rove-daemon/daemon/handlers-automations"
import { describe, expect, it } from "vitest"
import { NOW, REPO, fakeDeps, tempStore } from "./automation-runner-fixtures.ts"

const sign = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

function taskWithPr(id: string, overrides: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id,
    title: "work",
    repo: REPO,
    branch: "feat/demo",
    worktreePath: "/wt/demo",
    status: "in_progress",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as DaemonTask
}

describe("event-only routines (no cron schedule)", () => {
  it("persists without schedule/nextRunAt, never enters cron sweep, and keeps daemon alive when enabled", async () => {
    const store = await tempStore()
    const created = await store.create({
      name: "ci triage",
      repo: "/repo-a",
      prompt: "Fix failing CI",
      eventTriggers: [{ kind: "ci_failed", filter: { branch: "feat/*" } }],
      missedRunGraceMinutes: 60,
    })
    expect(created.schedule).toBeUndefined()
    expect(created.nextRunAt).toBeUndefined()
    expect(automationTriggerMode(created)).toBe("event")
    expect(store.hasEnabled()).toBe(true)
    expect(hasPrEventRoutine(store.list())).toBe(true)
    expect(dueAutomations(store.list(), NOW + 365 * 86_400_000)).toEqual([])

    const { deps, created: spawned } = fakeDeps({ store })
    await sweepAutomations(deps)
    expect(spawned).toEqual([])
  })

  it("refuses creating or updating a routine with neither schedule nor event/webhook trigger", async () => {
    const store = await tempStore()
    await expect(
      store.create({ name: "empty", repo: "/repo-a", prompt: "do something", missedRunGraceMinutes: 60 }),
    ).rejects.toThrow(/needs a schedule, an event trigger, or a webhook/)

    const scheduled = await store.create({
      name: "sched",
      repo: "/repo-a",
      prompt: "p",
      schedule: "0 9 * * *",
      missedRunGraceMinutes: 60,
    })
    await expect(store.update(scheduled.id, { schedule: null })).rejects.toThrow(
      /needs a schedule, an event trigger, or a webhook/,
    )

    // Converting schedule → hybrid → pure event works cleanly.
    const hybrid = await store.update(scheduled.id, { eventTriggers: [{ kind: "local", filter: { event: "build" } }] })
    expect(hybrid && automationTriggerMode(hybrid)).toBe("hybrid")

    const eventOnly = await store.update(scheduled.id, { schedule: null })
    expect(eventOnly?.schedule).toBeUndefined()
    expect(eventOnly?.nextRunAt).toBeUndefined()
    expect(eventOnly && automationTriggerMode(eventOnly)).toBe("event")
  })
})

describe("PR poller event watcher (ci_failed and pr_review_requested)", () => {
  it("seeds existing failing PRs on boot without firing, then fires on new failures or new head commits", async () => {
    const store = await tempStore()
    const routine = await store.create({
      name: "fix ci",
      repo: REPO,
      prompt: "Investigate CI",
      eventTriggers: [{ kind: "ci_failed", filter: { branch: "feat/*" } }],
      missedRunGraceMinutes: 60,
    })
    const { deps, prompts } = fakeDeps({ store })

    let snapshot: DaemonTask[] = [
      taskWithPr("t1", {
        prStatus: {
          provider: "github",
          lifecycle: "open",
          checkState: "failing",
          number: 10,
          headSha: "aaa1111",
          url: "https://github.com/org/repo/pull/10",
        },
      }),
    ]
    const bus = new DaemonEventBus()
    const stop = startAutomationEventWatcher({ listTasks: () => snapshot }, bus, deps)

    // Unchanged failing PR must not fire.
    bus.publish("task.snapshot", { tasks: snapshot as never })
    await Promise.resolve()
    expect(prompts).toEqual([])

    // Same PR fails on a NEW commit sha → fires.
    snapshot = [
      taskWithPr("t1", {
        prStatus: {
          provider: "github",
          lifecycle: "open",
          checkState: "failing",
          number: 10,
          headSha: "bbb2222",
          url: "https://github.com/org/repo/pull/10",
        },
      }),
    ]
    bus.publish("task.snapshot", { tasks: snapshot as never })
    await new Promise((r) => setTimeout(r, 20))
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain("Fired by event (ci_failed):")
    expect(prompts[0]).toContain("PR #10 on feat/demo (bbb2222)")
    expect(store.runsFor(routine.id)[0]).toMatchObject({ trigger: "event", status: "dispatched" })

    // A PR on a non-matching branch or another repo does NOT fire.
    snapshot = [
      ...snapshot,
      taskWithPr("t2", {
        branch: "chore/skip",
        prStatus: { provider: "github", lifecycle: "open", checkState: "failing", number: 11, headSha: "ccc3333" },
      }),
      taskWithPr("t3", {
        repo: "/repo-other",
        branch: "feat/other",
        prStatus: { provider: "github", lifecycle: "open", checkState: "failing", number: 12, headSha: "ddd4444" },
      }),
    ]
    bus.publish("task.snapshot", { tasks: snapshot as never })
    await new Promise((r) => setTimeout(r, 20))
    expect(prompts).toHaveLength(1)
    stop()
  })

  it("emits pr_review_requested when reviewDecision transitions to REVIEW_REQUIRED or CHANGES_REQUESTED", () => {
    const observed = new Map()
    const base = taskWithPr("t1", {
      prStatus: { provider: "github", lifecycle: "open", checkState: "passing", number: 22 },
    })
    expect(extractPrTriggerEvents(observed, [base], true)).toEqual([])

    const reviewReq = taskWithPr("t1", {
      prStatus: {
        provider: "github",
        lifecycle: "open",
        checkState: "passing",
        number: 22,
        reviewDecision: "REVIEW_REQUIRED",
        url: "https://github.com/org/repo/pull/22",
      },
    })
    const events = extractPrTriggerEvents(observed, [reviewReq], false)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: "pr_review_requested",
      action: "review_required",
      branch: "feat/demo",
      repo: REPO,
    })
    // Re-emitting the same unchanged snapshot produces no duplicate event.
    expect(extractPrTriggerEvents(observed, [reviewReq], false)).toEqual([])
  })
})

describe("webhook filtering and local event hooks", () => {
  const webhookHandler = AUTOMATION_HANDLERS.find((h) => h.name === "automation.webhook")!
  const emitHandler = AUTOMATION_HANDLERS.find((h) => h.name === "automation.emitEvent")!
  const listHandler = AUTOMATION_HANDLERS.find((h) => h.name === "automation.list")!

  it("returns ignored when a webhook does not match the routine's eventTriggers", async () => {
    const store = await tempStore()
    const secret = "hook-secret"
    const issueRoutine = await store.create({
      name: "issue triage",
      repo: "/repo-a",
      prompt: "triage",
      eventTriggers: [{ kind: "issue_opened" }],
      webhook: { secret },
      missedRunGraceMinutes: 60,
    })
    const closedBody = JSON.stringify({ action: "closed", issue: { number: 3 } })
    const openedBody = JSON.stringify({ action: "opened", issue: { number: 4 } })

    expect(
      webhookMatchesTriggers(issueRoutine.eventTriggers!, readWebhookEvent("issues", closedBody), closedBody),
    ).toBe(false)
    expect(
      webhookMatchesTriggers(issueRoutine.eventTriggers!, readWebhookEvent("issues", openedBody), openedBody),
    ).toBe(true)

    const ctx = { automations: store } as never
    const res = (await webhookHandler.handle(
      { id: issueRoutine.id, event: "issues", body: closedBody, signature: sign(secret, closedBody) },
      ctx,
    )) as { verdict: string }
    expect(res.verdict).toBe("ignored")
    expect(store.runsFor(issueRoutine.id)).toEqual([])
  })

  it("dispatches local hooks via automation.emitEvent and filters automation.list by mode", async () => {
    const store = await tempStore()
    const { deps, prompts } = fakeDeps({ store })
    const sched = await store.create({
      name: "cron job",
      repo: REPO,
      prompt: "scheduled",
      schedule: "0 9 * * *",
      missedRunGraceMinutes: 60,
    })
    const local = await store.create({
      name: "deploy hook",
      repo: REPO,
      prompt: "smoke test",
      eventTriggers: [{ kind: "local", filter: { event: "deploy.*", branch: "main" } }],
      missedRunGraceMinutes: 60,
    })

    const ctx = {
      automations: store,
      deliveries: deps.deliveries,
      orch: deps.orch,
      runtime: deps.runtime,
      selfLink: deps.link,
      inbox: deps.inbox,
    } as never

    const listEvents = (await listHandler.handle({ mode: "event" }, ctx)) as { automations: Automation[] }
    expect(listEvents.automations.map((a) => a.id)).toEqual([local.id])
    const listSched = (await listHandler.handle({ mode: "schedule" }, ctx)) as { automations: Automation[] }
    expect(listSched.automations.map((a) => a.id)).toEqual([sched.id])

    // Non-matching branch does not fire.
    const miss = (await emitHandler.handle({ event: "deploy.finished", repo: REPO, branch: "dev" }, ctx)) as {
      matched: number
    }
    expect(miss.matched).toBe(0)

    // Matching local event fires with precheck env + prompt header.
    const hit = (await emitHandler.handle(
      { event: "deploy.finished", repo: REPO, branch: "main", detail: "v2.0" },
      ctx,
    )) as { matched: number; fired: Array<{ automationId: string; status: string }> }
    expect(hit.matched).toBe(1)
    expect(hit.fired[0]).toMatchObject({ automationId: local.id, status: "dispatched" })
    expect(prompts[0]).toContain("Fired by event (local): deploy.finished on main v2.0")

    // Direct dispatch helper respects precheck env vars (`ROVE_EVENT_BRANCH`).
    const prechecked = await store.create({
      name: "env check",
      repo: REPO,
      prompt: "ok",
      eventTriggers: [{ kind: "local", filter: { event: "check" } }],
      precheck: { command: 'test "$ROVE_EVENT_BRANCH" = "main"', timeoutSeconds: 10 },
      missedRunGraceMinutes: 60,
    })
    const results = await dispatchAutomationEvent(deps, {
      kind: "local",
      name: "check",
      repo: REPO,
      branch: "feature",
      summary: "check on feature",
    })
    expect(results.find((r) => r.automationId === prechecked.id)?.status).toBe("skipped_precheck")
  })
})

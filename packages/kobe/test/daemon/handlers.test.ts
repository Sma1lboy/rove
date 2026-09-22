import { DaemonActivityRegistry } from "@sma1lboy/kobe-daemon/daemon/activity-registry"
import { EngineEventLog } from "@sma1lboy/kobe-daemon/daemon/engine-events-log"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { PromptBroker } from "@sma1lboy/kobe-daemon/daemon/prompt-broker"
import type { DaemonHandlerContext } from "@sma1lboy/kobe-daemon/daemon/server"
import { describe, expect, it } from "vitest"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

/**
 * RPC dispatch seam tests (registry in `kobe-daemon/src/daemon/handlers.ts`).
 *
 * WHY these matter: the registry makes the RPC dispatch seam testable WITHOUT
 * a socket — dispatch through a fake context and assert the payload, instead
 * of leaving the end-to-end socket suite as the only proof the surface works.
 * These tests pin the
 * WIRE CONTRACT — success payload shapes (including which calls return `{}`
 * vs an object), validation-error wording (`"repo is required"`), and the
 * unknown-request error — so a future handler edit that drifts the on-wire
 * shape fails here first, not in a client.
 *
 * `subscribe` is deliberately absent from the registry (connection
 * lifecycle — per-socket state + the gui-refcount idle timer + direct
 * channel-replay writes); its behavior is covered end-to-end by
 * `lazy-shutdown.test.ts` over a real socket.
 *
 * Task CRUD, the issue store, and the worktree verbs live in the sibling
 * `handlers-task-crud.test.ts`, and the daemon-PROCESS verbs (`daemon.status`,
 * `daemon.stop`) in `handlers-daemon-lifecycle.test.ts` — this file keeps the
 * RPCs that move task and UI state (both splits were the 500-line cap).
 */

describe("daemon handler registry", () => {
  describe("ui.reportEvent", () => {
    it("feeds valid UI kinds to the plugin sink and rejects unknown kinds", async () => {
      const { ctx } = fakeCtx({ getTask: () => TASK })
      const seen: unknown[] = []
      ;(ctx as { plugins?: unknown }).plugins = {
        handleEngineReport: () => {},
        handleUiReport: (r: unknown) => seen.push(r),
      }
      await dispatch("ui.reportEvent", { kind: "file.opened", taskId: "t1", detail: { path: "/x.mp4" } }, ctx)
      expect(seen).toEqual([{ kind: "file.opened", taskId: "t1", detail: { path: "/x.mp4" } }])
      await expect(dispatch("ui.reportEvent", { kind: "task.created" }, ctx)).rejects.toThrow(/unknown ui event/)
    })

    // `tab.closed` is the ONE place every terminal-tab close funnels through
    // (the TUI's own path, and the daemon's `terminalTab.close`, which drives
    // it). A real registry, not a spy: the assertion is that the LEDGER is
    // swept, so cutting either the wiring here or `clearTab` itself fails.
    it("sweeps the closed tab's activity ledger entry", async () => {
      const { ctx } = fakeCtx({ getTask: () => TASK })
      const bus = new DaemonEventBus()
      const activity = new DaemonActivityRegistry(bus, 60_000)
      ;(ctx as { activity: DaemonActivityRegistry }).activity = activity
      ;(ctx as { plugins?: unknown }).plugins = { handleEngineReport: () => {}, handleUiReport: () => {} }
      try {
        activity.report("t1", "turn-start", undefined, "tab-1")
        expect(activity.debugSnapshot().tabs.t1?.["tab-1"]?.state).toBe("running")

        await dispatch("ui.reportEvent", { kind: "tab.closed", taskId: "t1", detail: { tabId: "tab-1" } }, ctx)

        expect(activity.debugSnapshot().tabs.t1?.["tab-1"]).toBeUndefined()
        // …and the task row follows: nothing is left to be running.
        expect(activity.replaySnapshot()).toEqual([])
      } finally {
        activity.close()
      }
    })
  })

  describe("ui.prompt / ui.promptReply", () => {
    it("publishes the request and resolves with the reply (first answer wins)", async () => {
      const { ctx, rec } = fakeCtx({ getTask: () => TASK })
      ;(ctx as { prompts?: PromptBroker }).prompts = new PromptBroker()
      const pending = dispatch("ui.prompt", { title: "URL?", placeholder: "https://…" }, ctx)
      const published = rec.published.find((p) => p.channel === "ui.prompt")
      expect(published?.payload).toMatchObject({ title: "URL?", placeholder: "https://…" })
      const promptId = (published?.payload as { promptId: string }).promptId
      const ok = await dispatch("ui.promptReply", { promptId, value: "https://kobe.dev" }, ctx)
      expect(ok).toEqual({ ok: true })
      expect(await pending).toEqual({ value: "https://kobe.dev" })
      // A second reply to the same prompt is dropped.
      expect(await dispatch("ui.promptReply", { promptId, value: "late" }, ctx)).toEqual({ ok: false })
    })

    it("a value-less reply cancels, and unknown ids settle nothing", async () => {
      const { ctx, rec } = fakeCtx({ getTask: () => TASK })
      ;(ctx as { prompts?: PromptBroker }).prompts = new PromptBroker()
      const pending = dispatch("ui.prompt", { title: "name?" }, ctx)
      const promptId = (rec.published.find((p) => p.channel === "ui.prompt")?.payload as { promptId: string }).promptId
      expect(await dispatch("ui.promptReply", { promptId: "nope", value: "x" }, ctx)).toEqual({ ok: false })
      await dispatch("ui.promptReply", { promptId }, ctx)
      expect(await pending).toEqual({ cancelled: true, reason: "cancelled" })
    })
  })

  describe("engine.reportEvent lifecycle kinds", () => {
    it("buffers every kind, publishes engine.lifecycle for low-frequency ones, and skips the badge", async () => {
      const { ctx, rec } = fakeCtx({ getTask: () => TASK })
      const log = new EngineEventLog()
      ;(ctx as { engineEvents?: EngineEventLog }).engineEvents = log
      await dispatch("engine.reportEvent", { taskId: "t1", kind: "pre-compact" }, ctx)
      await dispatch("engine.reportEvent", { taskId: "t1", kind: "tool-post", detail: { tool: { name: "Bash" } } }, ctx)
      // Lifecycle-only kinds never touch the activity badge or the inbox.
      expect(rec.reported).toHaveLength(0)
      expect(rec.inboxRecords).toHaveLength(0)
      // Only the low-frequency kind broadcast on engine.lifecycle (no tool spam).
      const lifecycle = rec.published.filter((p) => p.channel === "engine.lifecycle")
      expect(lifecycle).toHaveLength(1)
      expect(lifecycle[0]?.payload).toMatchObject({ taskId: "t1", kind: "pre-compact" })
      // Both kinds landed in the recent-events buffer, readable over RPC.
      const res = (await dispatch("task.recentEvents", { taskId: "t1" }, ctx)) as { events: { kind: string }[] }
      expect(res.events.map((e) => e.kind)).toEqual(["pre-compact", "tool-post"])
    })
  })

  describe("tab.close", () => {
    it("publishes a tab.close event for a known task and rejects an unknown one", async () => {
      const { ctx, rec } = fakeCtx({ getTask: (id: string) => (id === "t1" ? TASK : undefined) })
      const before = Date.now()
      const result = await dispatch("tab.close", { taskId: "t1", title: "demo" }, ctx)
      expect(result).toEqual({ ok: true, clients: 1 })
      const event = rec.published[0] as { channel: string; payload: Record<string, unknown> }
      expect(event.channel).toBe("tab.close")
      expect(event.payload).toMatchObject({ taskId: "t1", title: "demo" })
      expect(event.payload.at as number).toBeGreaterThanOrEqual(before)
      const { ctx: ctx2 } = fakeCtx({ getTask: () => undefined })
      await expect(dispatch("tab.close", { taskId: "nope", title: "t" }, ctx2)).rejects.toThrow(/task not found/)
    })

    it("carries an explicit tabId through (pane-close --tab)", async () => {
      const { ctx, rec } = fakeCtx({ getTask: () => TASK })
      await dispatch("tab.close", { taskId: "t1", title: "demo", tabId: "tab-3" }, ctx)
      const event = rec.published[0] as { payload: Record<string, unknown> }
      expect(event.payload.tabId).toBe("tab-3")
    })
  })

  describe("terminalTab.close", () => {
    it("waits for an attached TUI to confirm the exact tab close", async () => {
      const { ctx, rec } = fakeCtx({ getTask: () => TASK })
      const pending = dispatch("terminalTab.close", { taskId: "t1", tabId: "tab-3" }, ctx)
      const event = rec.published[0] as { channel: string; payload: Record<string, unknown> }
      expect(event.channel).toBe("tab.close")
      expect(event.payload).toMatchObject({ kind: "terminal-tab", taskId: "t1", tabId: "tab-3" })
      const requestId = event.payload.requestId as string
      expect(await dispatch("terminalTab.closeReply", { requestId, closed: true }, ctx)).toEqual({ ok: true })
      expect(await pending).toEqual({ ok: true, handled: true })
      expect(await dispatch("terminalTab.closeReply", { requestId, closed: true }, ctx)).toEqual({ ok: false })
    })

    it("returns immediately for headless callers and rejects an unknown task", async () => {
      const { ctx, rec } = fakeCtx({ getTask: (id: string) => (id === "t1" ? TASK : undefined) })
      ;(ctx.daemon as { guiCount: () => number }).guiCount = () => 0
      await expect(dispatch("terminalTab.close", { taskId: "t1", tabId: "tab-1" }, ctx)).resolves.toEqual({
        ok: true,
        handled: false,
      })
      expect(rec.published).toHaveLength(0)
      await expect(dispatch("terminalTab.close", { taskId: "missing", tabId: "tab-1" }, ctx)).rejects.toThrow(
        /task not found/,
      )
    })
  })

  describe("tab.open", () => {
    it("publishes a tab.open event for a known task", async () => {
      const { ctx, rec } = fakeCtx({ getTask: (id: string) => (id === "t1" ? TASK : undefined) })
      const before = Date.now()
      const result = await dispatch("tab.open", { taskId: "t1", argv: ["sh", "-lc", "true"], title: "demo" }, ctx)
      expect(result).toEqual({ ok: true, clients: 1 })
      const event = rec.published[0] as { channel: string; payload: Record<string, unknown> }
      expect(event.channel).toBe("tab.open")
      expect(event.payload).toMatchObject({ taskId: "t1", argv: ["sh", "-lc", "true"], title: "demo" })
      expect(event.payload.at as number).toBeGreaterThanOrEqual(before)
    })

    it("rejects an unknown task and a malformed argv", async () => {
      const { ctx } = fakeCtx({ getTask: () => undefined })
      await expect(dispatch("tab.open", { taskId: "nope", argv: ["x"], title: "t" }, ctx)).rejects.toThrow(
        /task not found/,
      )
      const { ctx: ctx2 } = fakeCtx({ getTask: () => TASK })
      await expect(dispatch("tab.open", { taskId: "t1", argv: [], title: "t" }, ctx2)).rejects.toThrow(/argv/)
    })

    it("carries an explicit tabId through (pane-open --tab)", async () => {
      const { ctx, rec } = fakeCtx({ getTask: () => TASK })
      await dispatch("tab.open", { taskId: "t1", argv: ["x"], title: "t", tabId: "tab-3" }, ctx)
      const event = rec.published[0] as { payload: Record<string, unknown> }
      expect(event.payload.tabId).toBe("tab-3")
    })
  })

  describe("session.deliver", () => {
    /** Swap in a canned delivery verdict for the exact-tab adapter. */
    const withOutcome = (ctx: DaemonHandlerContext, outcome: unknown): DaemonHandlerContext =>
      ({
        ...ctx,
        runtime: { ...ctx.runtime, deliverPromptToLiveEngineTabDetailed: async () => outcome },
      }) as DaemonHandlerContext

    it("reports the paste it actually performed, and does NOT also broadcast it", async () => {
      // The bug this pins: `dispatch` against a TUI-hosted task used to answer
      // `ok: true` while nothing pasted, because the daemon only broadcast and
      // the TUI never subscribed. Delivering AND publishing would be the
      // opposite failure — a listening browser pasting the same text twice.
      const { ctx, rec } = fakeCtx({ getTask: (id: string) => (id === "t1" ? TASK : undefined) })
      const result = await dispatch(
        "session.deliver",
        { taskId: "t1", text: "hi", tabId: "tab-2" },
        withOutcome(ctx, { outcome: "delivered", tabId: "tab-2" }),
      )
      expect(result).toEqual({ ok: true, delivered: true, tabId: "tab-2", clients: 1 })
      expect(rec.published).toHaveLength(0)
    })

    it("falls back to the broadcast when no hosted session answers", async () => {
      // The browser-hosted case: the SPA mints its own tab ids, so its
      // sessions are invisible to the PTY host and the channel is the only
      // way to reach one. `delivered: false` says the paste is unconfirmed.
      const { ctx, rec } = fakeCtx({ getTask: (id: string) => (id === "t1" ? TASK : undefined) })
      const result = await dispatch(
        "session.deliver",
        { taskId: "t1", text: "hi", tabId: "tab-2" },
        withOutcome(ctx, { outcome: "no-session" }),
      )
      expect(result).toEqual({ ok: true, delivered: false, reason: "broadcast", clients: 1 })
      const event = rec.published[0] as { channel: string; payload: Record<string, unknown> }
      expect(event.channel).toBe("session.deliver")
      expect(event.payload).toMatchObject({ taskId: "t1", text: "hi", tabId: "tab-2", source: "dispatcher" })
    })
  })

  describe("notice.send", () => {
    it("publishes a notice.event with a stamped `at` and the default kind", async () => {
      const { ctx, rec } = fakeCtx()
      const before = Date.now()
      const result = await dispatch("notice.send", { title: "build done" }, ctx)
      expect(result).toEqual({ ok: true, clients: 1 })
      expect(rec.published).toHaveLength(1)
      const event = rec.published[0] as { channel: string; payload: Record<string, unknown> }
      expect(event.channel).toBe("notice.event")
      expect(event.payload.title).toBe("build done")
      expect(event.payload.kind).toBe("done")
      expect(event.payload.taskId).toBeUndefined()
      expect(typeof event.payload.at).toBe("number")
      expect(event.payload.at as number).toBeGreaterThanOrEqual(before)
    })

    it("carries kind/taskId/source through when valid", async () => {
      const { ctx, rec } = fakeCtx({ getTask: (id: string) => (id === "t1" ? TASK : undefined) })
      await dispatch(
        "notice.send",
        { title: "needs a decision", kind: "needs_input", taskId: "t1", source: "api" },
        ctx,
      )
      const payload = (rec.published[0] as { payload: Record<string, unknown> }).payload
      expect(payload.kind).toBe("needs_input")
      expect(payload.taskId).toBe("t1")
      expect(payload.source).toBe("api")
    })

    it("rejects an empty kind and an unknown task", async () => {
      const { ctx, rec } = fakeCtx({ getTask: () => undefined })
      await expect(dispatch("notice.send", { title: "x", kind: "  " }, ctx)).rejects.toThrow(
        "kind must be a non-empty string",
      )
      await expect(dispatch("notice.send", { title: "x", taskId: "nope" }, ctx)).rejects.toThrow("task not found: nope")
      expect(rec.published).toHaveLength(0)
    })
  })

  describe("broadcast reach (clients)", () => {
    // A broadcast-only handler returning a bare { ok: true } reads to a
    // headless agent (no TUI attached) as "the pane opened", reporting a
    // thing that never happened. `clients` is the same reach signal
    // `session.deliver` reports: connection count, where 0 is the
    // unambiguous "nobody performed it".
    it("tab.open / tab.close / notice.send report clients: 0 when nothing is attached", async () => {
      const { ctx } = fakeCtx({ getTask: () => TASK })
      ;(ctx.daemon as { clientCount: () => number }).clientCount = () => 0
      await expect(dispatch("tab.open", { taskId: "t1", argv: ["x"], title: "t" }, ctx)).resolves.toEqual({
        ok: true,
        clients: 0,
      })
      await expect(dispatch("tab.close", { taskId: "t1", title: "t" }, ctx)).resolves.toEqual({
        ok: true,
        clients: 0,
      })
      await expect(dispatch("notice.send", { title: "t" }, ctx)).resolves.toEqual({ ok: true, clients: 0 })
    })
  })

  describe("engine.reportEvent (payload contract pinned — the activity hooks depend on it)", () => {
    it("maps cwd → task and folds the coerced detail into the activity registry", async () => {
      const { ctx, rec } = fakeCtx({ listTasks: () => [TASK] })
      const result = await dispatch(
        "engine.reportEvent",
        {
          kind: "awaiting-input",
          cwd: `${TASK.worktreePath}/src/deep`,
          // `junk` must be dropped; the normalized keys survive.
          detail: { waiting: "permission", junk: 1 },
        },
        ctx,
      )
      expect(result).toEqual({})
      expect(rec.reported).toEqual([{ taskId: "t1", kind: "awaiting-input", detail: { waiting: "permission" } }])
    })

    it("an explicit taskId wins over cwd resolution", async () => {
      const { ctx, rec } = fakeCtx({ listTasks: () => [TASK] })
      await dispatch(
        "engine.reportEvent",
        { kind: "turn-complete", taskId: "direct", tabId: "tab-3", cwd: TASK.worktreePath },
        ctx,
      )
      expect(rec.reported).toEqual([{ taskId: "direct", kind: "turn-complete", detail: undefined }])
      expect(rec.inboxRecords).toEqual([{ taskId: "direct", kind: "turn-complete", detail: undefined, tabId: "tab-3" }])
    })

    it("an unmatched cwd is silently dropped (returns {} with no report)", async () => {
      const { ctx, rec } = fakeCtx({ listTasks: () => [TASK] })
      await expect(
        dispatch("engine.reportEvent", { kind: "turn-start", cwd: "/somewhere/else" }, ctx),
      ).resolves.toEqual({})
      expect(rec.reported).toEqual([])
      expect(rec.inboxRecords).toEqual([])
    })

    it("rejects an unknown kind and a missing kind with the exact wording", async () => {
      const { ctx } = fakeCtx()
      await expect(dispatch("engine.reportEvent", { kind: "explode" }, ctx)).rejects.toThrow(
        "unknown engine event kind: explode",
      )
      await expect(dispatch("engine.reportEvent", { cwd: "/x" }, ctx)).rejects.toThrow("kind is required")
    })
  })

  describe("active-task focus channel", () => {
    it("task.setActive publishes the active-task channel after the orchestrator call", async () => {
      const active: Array<string | null> = []
      const { ctx, rec } = fakeCtx({
        setActiveTask: async (id: string | null) => {
          active.push(id)
        },
      })
      await expect(dispatch("task.setActive", { taskId: "t1" }, ctx)).resolves.toEqual({})
      // Omitted taskId means "clear focus" — null, not an error.
      await expect(dispatch("task.setActive", {}, ctx)).resolves.toEqual({})
      expect(active).toEqual(["t1", null])
      expect(rec.published).toEqual([
        { channel: "active-task", payload: { taskId: "t1" } },
        { channel: "active-task", payload: { taskId: null } },
      ])
    })
  })

  // "error shaping" moved to handlers-error-shape.test.ts (file-size cap).
})

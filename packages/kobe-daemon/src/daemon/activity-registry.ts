import { type EffectiveActivity, type HookSlot, type ObservedSlot, recomputeTabActivity } from "./activity-arbitrate.ts"
import { type ActivityDebugSnapshot, buildActivityDebugSnapshot } from "./activity-debug-dump.ts"
import { ActivityLapseWatchdog, type LapseEntry, type LapseTarget } from "./activity-lapse.ts"
import {
  type EngineStatePayload,
  type PayloadSource,
  activityPayload,
  ledgerTaskIds,
  liveSessions,
  replaySnapshot,
  taskRollup,
  workingTaskIds,
} from "./activity-readers.ts"
import {
  type ActivityLivenessProbe,
  type EngineSessionInfo,
  STICKY_STATES,
  reduceActivity,
  resolveEngineStateTtlMs,
} from "./activity-reduce.ts"
import type { RollupCandidate } from "./activity-rollup.ts"
import type { EngineActivityDetail, EngineActivityKind, TaskActivityState } from "./contracts.ts"
import type { DaemonEventBus } from "./event-bus.ts"

// This file is the module's one public entry point; re-export its halves.
export {
  type ActivityLiveness,
  type ActivityLivenessProbe,
  type EngineSessionInfo,
  DEFAULT_ENGINE_STATE_TTL_MS,
  resolveEngineStateTtlMs,
} from "./activity-reduce.ts"
export {
  type EffectiveActivity,
  type HookSlot,
  type ObservedSlot,
  type TabActivitySlots,
  recomputeTabActivity,
} from "./activity-arbitrate.ts"
export { type RollupCandidate, deriveTaskActivity, rollupCandidates } from "./activity-rollup.ts"
export { MAX_UNKNOWN_REARMS } from "./activity-lapse.ts"
export type { EngineStatePayload } from "./activity-readers.ts"

/**
 * A TAB-LESS hook entry: an engine started in a shell kobe didn't spawn has no
 * `KOBE_TAB_ID`, so its hooks report task-only. One rollup candidate beside
 * the task's tabs — NOT the rollup, which is derived (activity-rollup.ts).
 */
interface ActivityEntry {
  state: TaskActivityState
  detail?: EngineActivityDetail
  at: number
  /** Carried forward: must survive an event from an older `kobe hook` that omits it. */
  session?: EngineSessionInfo
  /** Hook `--engine` id, what the liveness probe asks about. Carried forward like `session`. */
  vendor?: string
  lapse?: ReturnType<typeof setTimeout>
}

/** A hook slot plus its lapse watchdog — the only slot that gets one. */
interface TabHookEntry extends HookSlot {
  lapse?: ReturnType<typeof setTimeout>
}

/**
 * ONE SLOT PER SOURCE, arbitrated by {@link recomputeTabActivity}. `report()`
 * writes only `hook`, `observeTab()` only `observed`; `effective` caches the
 * last result so a no-op write publishes nothing.
 */
interface TabEntry {
  hook?: TabHookEntry
  observed?: ObservedSlot
  effective: EffectiveActivity
}

/** What `observeTab` did — the caller (activity-observer) logs corrections. */
export type ObserveTabOutcome = "noop" | "observed-running" | "observed-idle" | "corrected-hook-running"

/**
 * Daemon-owned engine-badge state. UI state: replayed to subscribers and the
 * web snapshot, never persisted to tasks.json.
 *
 * Only the per-tab ledger is written; one pure function (activity-arbitrate.ts)
 * decides what subscribers see. The task rollup is DERIVED on demand
 * (activity-rollup.ts explains why a stored copy couldn't stay correct).
 */
export class DaemonActivityRegistry {
  /** Tab-less hook entries only (see {@link ActivityEntry}). */
  private readonly activity = new Map<string, ActivityEntry>()
  /** taskId → tabId → entry, for events that carried a `tabId`. */
  private readonly tabActivity = new Map<string, Map<string, TabEntry>>()
  /**
   * taskId → tabId → last reduced state, idle included. The ledger drops idle
   * tabs, but {@link reduceActivity} must tell "went quiet on the record" (a
   * Stop is an automated wake to swallow) from "never heard of it" (a turn that
   * outlived a daemon restart — its ● lamp is owed).
   */
  private readonly tabLineage = new Map<string, Map<string, TaskActivityState>>()

  constructor(
    private readonly bus: DaemonEventBus,
    private readonly staleMs = resolveEngineStateTtlMs(),
    private readonly now = () => Date.now(),
    /** Before idling a stale state, the watchdog asks whether the engine is
     *  still writing its transcript. Default: idle unconditionally. */
    private readonly livenessAt: ActivityLivenessProbe = () => Promise.resolve(undefined),
    /** PTY sessions can outlive a task's removal by a poll; without this an
     *  observation resurrects a deleted task's badge. */
    private readonly taskExists: (taskId: string) => boolean = () => true,
  ) {
    this.lapse = new ActivityLapseWatchdog({
      staleMs: this.staleMs,
      now: this.now,
      livenessAt: (taskId, vendor, transcriptPath) => this.livenessAt(taskId, vendor, transcriptPath),
      entryAt: (target) => this.lapseEntry(target),
      retire: (target) => this.retireLapsed(target),
    })
  }

  /** Safety net for a missed Stop/SessionEnd — see activity-lapse.ts. */
  private readonly lapse: ActivityLapseWatchdog

  report(
    taskId: string,
    kind: EngineActivityKind,
    detail?: EngineActivityDetail,
    tabId?: string,
    session?: EngineSessionInfo,
    vendor?: string,
  ): void {
    const at = this.now()
    // The reduce's `previous` is PER SOURCE: reducing against the task rollup
    // made tab B's Stop depend on tab A's turn-start.
    if (tabId) {
      // Tab session lineage only (event's id or this tab's previous): a
      // task-level id would leak another tab's, even another ENGINE's, session.
      // A hook event SUPERSEDES the tab's observed slot — hooks are
      // authoritative while the engine lives, so the gap-filler is dropped.
      const tabs = this.tabActivity.get(taskId) ?? new Map<string, TabEntry>()
      const prevTab = tabs.get(tabId)
      const lineage = this.tabLineage.get(taskId) ?? new Map<string, TaskActivityState>()
      const state = reduceActivity(prevTab?.effective.state ?? lineage.get(tabId), kind, detail)
      lineage.set(tabId, state)
      this.tabLineage.set(taskId, lineage)
      if (prevTab?.hook?.lapse) clearTimeout(prevTab.hook.lapse)
      const tabSession = session ?? prevTab?.hook?.session
      const tabVendor = vendor ?? prevTab?.hook?.vendor
      if (state === "idle") {
        // Idle CLEARS both slots: an ended tab must not linger as a candidate.
        tabs.delete(tabId)
      } else {
        const hook: TabHookEntry = { state, detail, at, session: tabSession, vendor: tabVendor }
        if (!STICKY_STATES.has(state)) hook.lapse = this.lapse.arm({ taskId, tabId }, at)
        tabs.set(tabId, {
          hook,
          effective: {
            state,
            at,
            source: "hook",
            ...(detail ? { detail } : {}),
            ...(tabVendor ? { vendor: tabVendor } : {}),
            ...(tabSession ? { session: tabSession } : {}),
          },
        })
      }
      if (tabs.size > 0) this.tabActivity.set(taskId, tabs)
      else this.tabActivity.delete(taskId)
      this.bus.publish("engine-state", this.payload(taskId, { state, detail, at, session: tabSession }, tabId))
      this.publishRollup(taskId)
      return
    }

    const prev = this.activity.get(taskId)
    if (prev?.lapse) clearTimeout(prev.lapse)
    const state = reduceActivity(prev?.state, kind, detail)
    const entry: ActivityEntry = {
      state,
      detail,
      at,
      session: session ?? prev?.session,
      vendor: vendor ?? prev?.vendor,
    }
    // Only non-sticky states get the lapse watchdog, so a missed Stop can't pin
    // `running`. {@link STICKY_STATES} stay until the next real event.
    if (state !== "idle" && !STICKY_STATES.has(state)) {
      entry.lapse = this.lapse.arm({ taskId }, at)
    }
    this.activity.set(taskId, entry)
    this.publishRollup(taskId)
  }

  /** The derived task-level state, or `undefined` when nothing ever reported. */
  private rollup(taskId: string): RollupCandidate | undefined {
    return taskRollup(taskId, this.activity, this.tabActivity)
  }

  /**
   * Every writer calls this after touching the ledger. An empty ledger
   * publishes an explicit idle so subscribers clear the badge.
   */
  private publishRollup(taskId: string): void {
    const derived = this.rollup(taskId)
    this.bus.publish("engine-state", this.payload(taskId, derived ?? { state: "idle", at: this.now() }))
  }

  /** Drop a closed tab's entry; left behind, its last claim stays in the rollup and replay for the daemon's life. */
  clearTab(taskId: string, tabId: string): void {
    const tabs = this.tabActivity.get(taskId)
    const entry = tabs?.get(tabId)
    if (!tabs || !entry) return
    if (entry.hook?.lapse) clearTimeout(entry.hook.lapse)
    tabs.delete(tabId)
    if (tabs.size === 0) this.tabActivity.delete(taskId)
    const lineage = this.tabLineage.get(taskId)
    lineage?.delete(tabId)
    if (lineage?.size === 0) this.tabLineage.delete(taskId)
    this.bus.publish("engine-state", { taskId, tabId, state: "idle", at: this.now() })
    this.publishRollup(taskId)
  }

  /** Retire a claim the watchdog found silent, and republish the rollup. */
  private retireLapsed(target: LapseTarget): void {
    if (target.tabId) {
      const tabs = this.tabActivity.get(target.taskId)
      if (tabs) {
        tabs.delete(target.tabId)
        if (tabs.size === 0) this.tabActivity.delete(target.taskId)
      }
      this.bus.publish("engine-state", { taskId: target.taskId, tabId: target.tabId, state: "idle", at: this.now() })
    } else {
      this.activity.delete(target.taskId)
    }
    this.publishRollup(target.taskId)
  }

  private lapseEntry(target: LapseTarget): LapseEntry | undefined {
    if (target.tabId) {
      return this.tabActivity.get(target.taskId)?.get(target.tabId)?.hook
    }
    return this.activity.get(target.taskId)
  }

  /**
   * Fold one OBSERVED fact (PTY output heartbeat / foreground walk) into the
   * tab's observed slot. Hook claims outrank observation except the one
   * correction (stale hook `running` vs fresher observed rest); a hook that
   * loses it is dropped so it can't come back. Sticky attention states are
   * NEVER touched — they mean "a human is needed" and carry no output.
   *
   * Observed entries, idle included, are STORED so late subscribers get the
   * same facts on replay; no lapse watchdog — the observer's poll retires them.
   */
  observeTab(
    taskId: string,
    tabId: string,
    claim: "working" | "rest",
    opts: { vendor?: string; correctHookRunningAfterMs?: number } = {},
  ): ObserveTabOutcome {
    if (!this.taskExists(taskId)) return "noop"
    const tabs = this.tabActivity.get(taskId) ?? new Map<string, TabEntry>()
    const entry = tabs.get(tabId)
    const prev = entry?.effective
    const observed: ObservedSlot = {
      state: claim === "working" ? "running" : "idle",
      at: this.now(),
      vendor: opts.vendor ?? entry?.observed?.vendor ?? entry?.hook?.vendor,
      session: entry?.observed?.session ?? entry?.hook?.session,
    }
    const effective = recomputeTabActivity(
      { hook: entry?.hook, observed },
      observed.at,
      opts.correctHookRunningAfterMs ?? Number.POSITIVE_INFINITY,
    )
    if (!effective) return "noop" // unreachable — the observed slot was just written

    // A hook claim observation DISPROVED (`running` corrected to rest, `dead`
    // outlived by output) is retired with its watchdog. Kept, the next ungated
    // pass (host-unreachable retire: Infinity gate) re-elects it at its old
    // `at` and the watchdog re-arms it for the outage. A new turn re-writes it.
    const hook = effective.source === "observed" ? undefined : entry?.hook

    // Same state, same source ⇒ quietly refresh the timestamp; no per-poll republish.
    if (entry && hook === entry.hook && prev && prev.state === effective.state && prev.source === effective.source) {
      entry.observed = observed
      return "noop"
    }
    if (hook === undefined && entry?.hook?.lapse) clearTimeout(entry.hook.lapse)

    tabs.set(tabId, { ...(hook ? { hook } : {}), observed, effective })
    this.tabActivity.set(taskId, tabs)
    this.bus.publish("engine-state", this.payload(taskId, effective, tabId))
    this.publishRollup(taskId)

    if (effective.source === "hook") return "noop" // the observation lost arbitration
    if (effective.state === "running") return "observed-running"
    return prev?.source === "hook" ? "corrected-hook-running" : "observed-idle"
  }

  /**
   * A tab's ENGINE PROCESS died, per the pty-host's `pty-exits.json`. No hook
   * can report this: a killed engine runs no Stop/SessionEnd, and folded into
   * idle a dead tab looks identical to a shell that never ran anything.
   *
   * Written to the HOOK slot (a claim about the engine), arbitrated by rule 0:
   * outranks a stale `running`; a NEWER hook event displaces it. Clean exits
   * are filtered by the caller.
   */
  recordEngineDeath(
    taskId: string,
    tabId: string,
    exit: { code?: number | null; signal?: string | null; lastLine?: string },
    at: number,
  ): void {
    const tabs = this.tabActivity.get(taskId) ?? new Map<string, TabEntry>()
    const prev = tabs.get(tabId)
    // A hook event after the death is a new session; don't bury it.
    if (prev?.hook && prev.hook.at > at) return
    if (prev?.hook?.lapse) clearTimeout(prev.hook.lapse)
    const detail: EngineActivityDetail = {
      exit: {
        ...(exit.code !== undefined ? { code: exit.code } : {}),
        ...(exit.signal !== undefined ? { signal: exit.signal } : {}),
        ...(exit.lastLine ? { lastLine: exit.lastLine } : {}),
      },
    }
    const vendor = prev?.hook?.vendor ?? prev?.observed?.vendor
    const session = prev?.hook?.session ?? prev?.observed?.session
    // No lapse watchdog: `dead` is sticky (a dead engine writes nothing, so
    // the liveness probe would idle exactly the tab that needs the badge).
    const hook: TabHookEntry = {
      state: "dead",
      at,
      detail,
      ...(vendor ? { vendor } : {}),
      ...(session ? { session } : {}),
    }
    const effective = recomputeTabActivity({ hook, ...(prev?.observed ? { observed: prev.observed } : {}) }, at)
    if (!effective) return
    tabs.set(tabId, { hook, ...(prev?.observed ? { observed: prev.observed } : {}), effective })
    this.tabActivity.set(taskId, tabs)
    this.bus.publish("engine-state", this.payload(taskId, effective, tabId))
    this.publishRollup(taskId)
  }

  clearTask(taskId: string): void {
    const gone = this.activity.get(taskId)
    if (gone?.lapse) clearTimeout(gone.lapse)
    this.activity.delete(taskId)
    // Explicit per-tab idles so subscribers drop tab-level candidates too.
    const tabs = this.tabActivity.get(taskId)
    this.tabActivity.delete(taskId)
    this.tabLineage.delete(taskId)
    if (tabs) {
      for (const [tabId, tabEntry] of tabs) {
        if (tabEntry.hook?.lapse) clearTimeout(tabEntry.hook.lapse)
        this.bus.publish("engine-state", { taskId, tabId, state: "idle", at: this.now() })
      }
    }
    // Explicit idle clears the badge and, since the bus caches one last value
    // per channel, a stale replay if the id is recreated. Either level counts:
    // most tasks only ledger per-tab.
    if (gone || tabs) this.bus.publish("engine-state", { taskId, state: "idle", at: this.now() })
  }

  /** Every task with a ledger entry at either level. */
  private taskIds(): Set<string> {
    return ledgerTaskIds(this.activity, this.tabActivity)
  }

  /** Tasks with a working engine — a GATE, not the replay. See activity-readers.ts. */
  workingTaskIds(): string[] {
    return workingTaskIds(this.activity, this.tabActivity)
  }

  /** Every tab holding a live engine session, idle included. */
  liveSessions(): EngineStatePayload[] {
    return liveSessions(this.tabActivity)
  }

  /** The full `engine-state` replay for a late subscriber. */
  replaySnapshot(): EngineStatePayload[] {
    return replaySnapshot(this.activity, this.tabActivity)
  }

  /** Raw dump for `kobe api inspect` ({@link buildActivityDebugSnapshot}). */
  debugSnapshot(): ActivityDebugSnapshot {
    const derived = new Map<string, RollupCandidate>()
    for (const taskId of this.taskIds()) {
      const entry = this.rollup(taskId)
      if (entry) derived.set(taskId, entry)
    }
    return buildActivityDebugSnapshot(derived, this.tabActivity)
  }

  close(): void {
    for (const entry of this.activity.values()) {
      if (entry.lapse) clearTimeout(entry.lapse)
    }
    for (const tabs of this.tabActivity.values()) {
      for (const entry of tabs.values()) {
        if (entry.hook?.lapse) clearTimeout(entry.hook.lapse)
      }
    }
    this.activity.clear()
    this.tabActivity.clear()
    this.tabLineage.clear()
  }

  private payload(taskId: string, entry: PayloadSource, tabId?: string): EngineStatePayload {
    return activityPayload(taskId, entry, tabId)
  }
}

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

// Pure reducer + policy constants/types live in activity-reduce.ts (file-size
// cap split); re-exported so this stays the one public entry point. The
// arbitration core likewise lives in activity-arbitrate.ts.
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
// The watchdog's one policy constant, surfaced here for the same reason as the
// rest: this file is the module's public entry point.
export { MAX_UNKNOWN_REARMS } from "./activity-lapse.ts"
// The read half — pure projections of the ledger below (activity-readers.ts).
export type { EngineStatePayload } from "./activity-readers.ts"

/**
 * A TAB-LESS hook entry: an engine the user started in a shell kobe did not
 * spawn inherits no `KOBE_TAB_ID`, so its hooks report task-only (see
 * `attention-inbox.ts`'s `record`). It is one more rollup candidate beside the
 * task's tabs — NOT the rollup itself, which is derived (activity-rollup.ts).
 */
interface ActivityEntry {
  state: TaskActivityState
  detail?: EngineActivityDetail
  at: number
  /** Carried forward across events that omit it — most hooks pipe it, but
   *  the latest-known id must survive an event from an older `kobe hook`. */
  session?: EngineSessionInfo
  /** The reporting engine's id (hook `--engine`) — what the liveness probe
   *  asks about. Carried forward like `session`. */
  vendor?: string
  lapse?: ReturnType<typeof setTimeout>
}

/** A hook slot plus its lapse watchdog — the only slot that gets one. */
interface TabHookEntry extends HookSlot {
  lapse?: ReturnType<typeof setTimeout>
}

/**
 * One tab's activity record, herdr-style: ONE SLOT PER SOURCE, arbitrated by
 * {@link recomputeTabActivity} (see activity-arbitrate.ts for the priority
 * rules). Writers never edit each other's slot — `report()` writes `hook`,
 * `observeTab()` writes `observed` — and `effective` caches the last
 * arbitrated result so a write that changes nothing publishes nothing.
 */
interface TabEntry {
  hook?: TabHookEntry
  observed?: ObservedSlot
  effective: EffectiveActivity
}

/** What `observeTab` did — the caller (activity-observer) logs corrections. */
export type ObserveTabOutcome = "noop" | "observed-running" | "observed-idle" | "corrected-hook-running"

/**
 * In-memory, daemon-owned activity registry for hook-driven engine badges.
 *
 * This is UI state, not task lifecycle: it is replayed to subscribers and the
 * web snapshot, but never persisted to tasks.json.
 *
 * The per-tab ledger is the ONLY thing written: hook events and observer facts
 * occupy separate slots and ONE pure function decides what subscribers see
 * (activity-arbitrate.ts), instead of each writer special-casing the other
 * source's entries. The task-level rollup every consumer reads is DERIVED from
 * that ledger on demand (activity-rollup.ts) rather than maintained as a
 * second copy — see that file for why the copy could not be kept correct.
 */
export class DaemonActivityRegistry {
  /** Tab-less hook entries only (see {@link ActivityEntry}) — one rollup
   *  candidate per task, not the rollup. */
  private readonly activity = new Map<string, ActivityEntry>()
  /** Per-tab records (taskId → tabId → entry) for events that carried a
   *  `tabId`. UI state like everything here — replayed, never persisted. */
  private readonly tabActivity = new Map<string, Map<string, TabEntry>>()
  /**
   * Per-tab REDUCER lineage (taskId → tabId → last reduced state), including
   * idle. The ledger above drops an idle tab — a closed tab must not stay a
   * rollup candidate — but {@link reduceActivity} still has to tell "this tab
   * went quiet on the record" from "this daemon has never heard of it": a Stop
   * on the first is an automated wake to swallow, on the second a turn that
   * outlived a daemon restart, and its ● lamp is owed.
   */
  private readonly tabLineage = new Map<string, Map<string, TaskActivityState>>()

  constructor(
    private readonly bus: DaemonEventBus,
    private readonly staleMs = resolveEngineStateTtlMs(),
    private readonly now = () => Date.now(),
    /**
     * Optional liveness probe. When omitted, the lapse watchdog idles a stale
     * state unconditionally (the pre-liveness behavior — existing unit tests
     * that don't wire a probe keep it). When supplied, the watchdog first asks
     * whether the engine is still writing its transcript before idling.
     */
    private readonly livenessAt: ActivityLivenessProbe = () => Promise.resolve(undefined),
    /**
     * Does this task still exist? The observer walks PTY sessions, which can
     * outlive the task's removal from the index by a poll — without this a
     * deleted task's observation re-created its ledger entry, resurrecting a
     * badge for a task the UI had already dropped.
     */
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
    // The reduce's `previous` is PER SOURCE. Reading the task rollup here was
    // the same conflation the rollup itself was: tab B's Stop reduced against
    // tab A's turn-start, so one tab's completion state depended on another's.
    if (tabId) {
      // A TAB-scoped publish must carry the TAB's session lineage only — the
      // event's own id, or the same tab's previous one. Inheriting a
      // task-level id here leaked another tab's (even another ENGINE's)
      // session onto a fresh tab whose hooks don't pipe session ids. A hook
      // event SUPERSEDES the observed slot for its tab: hooks are
      // authoritative while the engine lives (see activity-arbitrate.ts), so
      // the observation that filled the gap is dropped rather than left to
      // age against the fresh claim.
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
        // A closed/ended tab must not linger as a candidate — idle CLEARS
        // the tab's record (both slots) rather than being stored.
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
    // Safety net: only `running` is policed by the lapse watchdog — a missed
    // Stop/SessionEnd must not pin it forever, so it lapses to idle once the
    // engine genuinely goes silent (heartbeat probe below). Sticky states
    // (turn_complete + the attention states a user walks away to handle) stay
    // visible until the next real event clears them; see {@link STICKY_STATES}.
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
   * Publish the DERIVED task-level state. Every writer calls this after
   * touching the ledger — that is what makes an engine death, an observer
   * correction and a lapse all move the task row without any of them owning
   * a copy of it. An empty ledger publishes an explicit idle so subscribers
   * clear the badge rather than keeping the last non-idle one.
   */
  private publishRollup(taskId: string): void {
    const derived = this.rollup(taskId)
    this.bus.publish("engine-state", this.payload(taskId, derived ?? { state: "idle", at: this.now() }))
  }

  /**
   * Drop a closed tab's ledger entry. A tab that is GONE has no state to
   * arbitrate: leaving it behind kept its last claim in the rollup (and in
   * every late subscriber's replay) for the life of the daemon, so closing
   * the running tab of a task left the task row spinning.
   */
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

  /**
   * Retire a claim the watchdog found silent: drop it from the ledger and
   * republish the task rollup, so the lapse moves the task row like every
   * other writer does.
   */
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

  /** Read the hook entry the watchdog polices at a given scope. */
  private lapseEntry(target: LapseTarget): LapseEntry | undefined {
    if (target.tabId) {
      return this.tabActivity.get(target.taskId)?.get(target.tabId)?.hook
    }
    return this.activity.get(target.taskId)
  }

  /**
   * Fold one OBSERVED per-session fact (the activity observer's PTY output
   * heartbeat + foreground-walk reconciler) into the per-tab record's
   * OBSERVED slot. What subscribers see follows {@link recomputeTabActivity}'s
   * priority — hook claims outrank observation except the one documented
   * correction (a stale hook `running` vs a fresher observed rest), and a hook
   * slot that loses THAT correction is dropped here (see below) so it cannot
   * come back. Sticky attention states are NEVER touched: they mean "a human
   * is needed" and carry no output by nature.
   *
   * Observed entries (including idle ones) are STORED so the subscribe-time
   * replay hands late clients the same known-idle facts; they carry no
   * lapse watchdog — the observer's own poll retires them.
   */
  observeTab(
    taskId: string,
    tabId: string,
    claim: "working" | "rest",
    opts: { vendor?: string; correctHookRunningAfterMs?: number } = {},
  ): ObserveTabOutcome {
    // A PTY session outliving its task's deletion must not re-create a ledger
    // entry for a task nothing can navigate to.
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

    // A hook claim that observation just DISPROVED — a `running` corrected to
    // rest, or a `dead` outlived by fresh output — is retired along with its
    // watchdog, instead of being left to win the next arbitration. Keeping it resurrects the corrected tab as a phantom
    // `running` on the very next ungated pass (the host-unreachable retire
    // path passes no correction gate, so the Infinity default re-elects the
    // stale claim at its original `at`), and its lapse watchdog then re-arms
    // that claim for the whole outage. A genuinely new turn arrives as a
    // fresh hook event, which writes the slot again.
    const hook = effective.source === "observed" ? undefined : entry?.hook

    // Same state from the same source ⇒ a quiet refresh of the observed
    // slot's timestamp, no republish churn (a working engine re-asserted
    // every poll must not spam subscribers).
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
   * Record that a tab's ENGINE PROCESS died, from the pty-host's durable exit
   * record (`pty-exits.json` via `pty-exit-watch.ts`).
   *
   * This is the one activity fact no hook can ever report: a killed engine
   * (SIGTERM/SIGKILL, or a wrapper that exits under it) runs no Stop, no
   * SessionEnd, nothing. Before this existed the death reached the UI as
   * `applyRest(... "no engine in foreground")` — folded into idle — so a dead
   * tab rendered byte-identically to a shell that never ran anything.
   *
   * Written into the HOOK slot, because it is a claim about the engine, and
   * arbitrated by rule 0 (see activity-arbitrate.ts): it outranks a stale
   * `running`, and a NEWER hook event (a fresh session in the tab) displaces
   * it. A clean exit is not a death — the caller filters those, matching the
   * exit store's own noise rule.
   */
  recordEngineDeath(
    taskId: string,
    tabId: string,
    exit: { code?: number | null; signal?: string | null; lastLine?: string },
    at: number,
  ): void {
    const tabs = this.tabActivity.get(taskId) ?? new Map<string, TabEntry>()
    const prev = tabs.get(tabId)
    // A hook event from AFTER the death is a new session in this tab — the
    // record is history by then and must not bury a live engine.
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
    // Per-tab entries go with the task; explicit per-tab idles so every
    // subscriber drops its tab-level candidates too.
    const tabs = this.tabActivity.get(taskId)
    this.tabActivity.delete(taskId)
    this.tabLineage.delete(taskId)
    if (tabs) {
      for (const [tabId, tabEntry] of tabs) {
        if (tabEntry.hook?.lapse) clearTimeout(tabEntry.hook.lapse)
        this.bus.publish("engine-state", { taskId, tabId, state: "idle", at: this.now() })
      }
    }
    // Publish an explicit idle so every subscriber clears this task's badge.
    // The bus only caches one last value per channel, so this also prevents a
    // stale per-task replay if the id is quickly recreated. Gated on EITHER
    // level having held something — most tasks only ever ledger per-tab.
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

  /**
   * Raw diagnostic dump for `kobe api inspect` — see
   * {@link buildActivityDebugSnapshot} for what it shows and why it is not
   * the wire payload.
   */
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

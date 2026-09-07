import { type EffectiveActivity, type HookSlot, type ObservedSlot, recomputeTabActivity } from "./activity-arbitrate.ts"
import { type ActivityDebugSnapshot, buildActivityDebugSnapshot } from "./activity-debug-dump.ts"
import {
  type ActivityLiveness,
  type ActivityLivenessProbe,
  type EngineSessionInfo,
  STICKY_STATES,
  activityStillWorking,
  reduceActivity,
  resolveEngineStateTtlMs,
} from "./activity-reduce.ts"
import type { EngineActivityDetail, EngineActivityKind, TaskActivityState } from "./contracts.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import type { ChannelPayloads } from "./protocol.ts"

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

/** Task-level rollup entry — last-event-wins across the task's tabs. */
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
  /** Exact tab report that owns this rollup; inherited session paths are not ownership. */
  sourceHook?: TabHookEntry
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

export type EngineStatePayload = ChannelPayloads["engine-state"]

/** The subset of an entry the wire payload reads. */
interface PayloadSource {
  state: TaskActivityState
  detail?: EngineActivityDetail
  session?: EngineSessionInfo
  at: number
}

/**
 * In-memory, daemon-owned activity registry for hook-driven engine badges.
 *
 * This is UI state, not task lifecycle: it is replayed to subscribers and the
 * web snapshot, but never persisted to tasks.json.
 *
 * Two levels: the task-level rollup (last-event-wins across tabs, every
 * existing consumer reads it) and the per-tab ledger (the F7 attention jump's
 * tab precision + the tab strip's chip). The per-tab ledger is where the
 * multi-source arbitration lives: hook events and observer facts occupy
 * separate slots and ONE pure function decides what subscribers see, instead
 * of each writer special-casing the other source's entries.
 */
/** Scope key for the unified lapse watchdog — one abstraction covers both
 *  the task-level rollup and a per-tab hook slot. */
interface LapseTarget {
  readonly taskId: string
  readonly tabId?: string
}

/** The subset of an entry the lapse-timer abstraction reads and writes. */
type LapseEntry = Pick<ActivityEntry, "at" | "vendor" | "session" | "lapse">

export class DaemonActivityRegistry {
  private readonly activity = new Map<string, ActivityEntry>()
  /** Per-tab records (taskId → tabId → entry) for events that carried a
   *  `tabId`. UI state like everything here — replayed, never persisted. */
  private readonly tabActivity = new Map<string, Map<string, TabEntry>>()

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
  ) {}

  report(
    taskId: string,
    kind: EngineActivityKind,
    detail?: EngineActivityDetail,
    tabId?: string,
    session?: EngineSessionInfo,
    vendor?: string,
  ): void {
    const prev = this.activity.get(taskId)
    if (prev?.lapse) clearTimeout(prev.lapse)
    const state = reduceActivity(prev?.state, kind, detail)
    const at = this.now()
    const lineage = tabId ? this.tabActivity.get(taskId)?.get(tabId)?.hook : prev
    const entry: ActivityEntry = {
      state,
      detail,
      at,
      session: session ?? lineage?.session,
      vendor: vendor ?? lineage?.vendor,
    }
    // Safety net: only `running` is policed by the lapse watchdog — a missed
    // Stop/SessionEnd must not pin it forever, so it lapses to idle once the
    // engine genuinely goes silent (heartbeat probe below). Sticky states
    // (turn_complete + the attention states a user walks away to handle) stay
    // visible until the next real event clears them; see {@link STICKY_STATES}.
    if (state !== "idle" && !STICKY_STATES.has(state)) {
      entry.lapse = this.armLapse({ taskId }, at)
    }
    this.activity.set(taskId, entry)
    // Per-tab ledger. A TAB-scoped publish must carry the TAB's session
    // lineage only — the event's own id, or the same tab's previous one.
    // Inheriting the task-level rollup here leaked another tab's (even
    // another ENGINE's) session onto a fresh tab whose hooks don't pipe
    // session ids. A hook event SUPERSEDES the observed slot for its tab:
    // hooks are authoritative while the engine lives (see
    // activity-arbitrate.ts), so the observation that filled the gap is
    // dropped rather than left to age against the fresh claim.
    let publishEntry: PayloadSource = entry
    if (tabId) {
      const tabs = this.tabActivity.get(taskId) ?? new Map<string, TabEntry>()
      const prevTab = tabs.get(tabId)
      if (prevTab?.hook?.lapse) clearTimeout(prevTab.hook.lapse)
      const tabSession = session ?? prevTab?.hook?.session
      const tabVendor = vendor ?? prevTab?.hook?.vendor
      publishEntry = { state, detail, at, session: tabSession }
      if (state === "idle") {
        // A closed/ended tab must not linger as a candidate — idle CLEARS
        // the tab's record (both slots) rather than being stored.
        tabs.delete(tabId)
      } else {
        const hook: TabHookEntry = { state, detail, at, session: tabSession, vendor: tabVendor }
        entry.sourceHook = hook
        if (!STICKY_STATES.has(state)) hook.lapse = this.armLapse({ taskId, tabId }, at)
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
    }
    this.bus.publish("engine-state", this.payload(taskId, publishEntry, tabId))
  }

  /** Probe wrapper: a best-effort filesystem read must never crash the daemon,
   *  and a failed read of an identified session stays unknown. */
  private async probe(taskId: string, vendor?: string, transcriptPath?: string): Promise<ActivityLiveness | undefined> {
    try {
      return await this.livenessAt(taskId, vendor, transcriptPath)
    } catch {
      return transcriptPath ? { unknown: true } : undefined
    }
  }

  /**
   * Arm (or re-arm) the lapse watchdog for the entry stamped `at`. A long
   * single turn emits only `turn-start` … `Stop` over many minutes — nothing
   * in between — so a fixed timer would fire mid-turn and wrongly idle a
   * working agent. Bumping the TTL only moves that cliff. Instead, when the
   * timer fires we probe whether the engine is still writing its transcript:
   * a write within the trailing `staleMs` window ⇒ the turn is alive, so we
   * re-arm (a heartbeat) instead of idling. Only a genuinely silent engine
   * (no recent write ⇒ a missed Stop / hung process) lapses to idle.
   *
   * One helper covers both the task-level rollup and per-tab hook slots; the
   * callback resolves the right ledger by the scope key.
   */
  private armLapse(target: LapseTarget, at: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      void this.handleLapse(target, at)
    }, this.staleMs)
    timer.unref?.()
    return timer
  }

  /**
   * Lapse-timer callback. Never throws. Guards against the entry changing
   * across the async probe: a `report()` / `clearTask()` / `close()` that runs
   * before OR during the probe supersedes this lapse (re-read the map and
   * confirm the same entry identity after the await). A rescheduled
   * lapse is stored back on the live entry, so a later event can cancel it.
   *
   * One implementation covers both the task-level rollup and the per-tab hook
   * slot — the policy (probe, supersede guard, heartbeat) is identical; only
   * the idle cleanup differs.
   */
  private async handleLapse(target: LapseTarget, at: number): Promise<void> {
    // Superseded before we even probed (a fresh report swapped the entry).
    const before = this.lapseEntry(target)
    if (!before || before.at !== at) return

    const live = await this.probe(target.taskId, before.vendor, before.session?.transcriptPath)

    // Re-read after the await: the entry may have been replaced or cleared
    // while the probe was in flight. Acting on a stale `at` would clobber a
    // newer state or resurrect a cleared task.
    const cur = this.lapseEntry(target)
    if (cur !== before) return

    if (activityStillWorking(live, at, this.now(), this.staleMs)) {
      cur.lapse = this.armLapse(target, at)
      return
    }

    if (target.tabId) {
      const tabs = this.tabActivity.get(target.taskId)
      if (tabs) {
        tabs.delete(target.tabId)
        if (tabs.size === 0) this.tabActivity.delete(target.taskId)
      }
      this.bus.publish("engine-state", { taskId: target.taskId, tabId: target.tabId, state: "idle", at: this.now() })
    } else {
      this.publishIdle(target.taskId)
    }
  }

  /** Read the hook entry that a lapse watchdog polices at a given scope. */
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

    if (effective.source === "observed" && effective.state === "idle") this.clearHookRollup(taskId, entry?.hook)
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
    this.clearHookRollup(taskId, prev?.hook)
    this.bus.publish("engine-state", this.payload(taskId, effective, tabId))
  }

  private clearHookRollup(taskId: string, hook: TabHookEntry | undefined): void {
    const current = this.activity.get(taskId)
    if (current?.state === "running" && hook && current.sourceHook === hook) {
      this.publishIdle(taskId)
    }
  }

  clearTask(taskId: string): void {
    const gone = this.activity.get(taskId)
    if (gone?.lapse) clearTimeout(gone.lapse)
    this.activity.delete(taskId)
    // Per-tab entries go with the task; explicit per-tab idles so every
    // subscriber drops its tab-level candidates too.
    const tabs = this.tabActivity.get(taskId)
    this.tabActivity.delete(taskId)
    if (tabs) {
      for (const [tabId, tabEntry] of tabs) {
        if (tabEntry.hook?.lapse) clearTimeout(tabEntry.hook.lapse)
        this.bus.publish("engine-state", { taskId, tabId, state: "idle", at: this.now() })
      }
    }
    // Publish an explicit idle so every subscriber clears this task's badge.
    // The bus only caches one last value per channel, so this also prevents a
    // stale per-task replay if the id is quickly recreated.
    if (gone) this.bus.publish("engine-state", { taskId, state: "idle", at: this.now() })
  }

  snapshotByTask(): Record<string, EngineStatePayload> {
    const out: Record<string, EngineStatePayload> = {}
    for (const [taskId, entry] of this.activity) out[taskId] = this.payload(taskId, entry)
    return out
  }

  currentNonIdle(): EngineStatePayload[] {
    const out: EngineStatePayload[] = []
    for (const [taskId, entry] of this.activity) {
      if (entry.state !== "idle") out.push(this.payload(taskId, entry))
    }
    // Tab entries ride the same replay so a late subscriber rebuilds its
    // per-tab map too. Hook-driven entries are only stored non-idle; the
    // OBSERVED slot includes known-idle ones on purpose — replaying them is
    // what lets a late client tell "known idle" from "no signal" (unknown).
    for (const [taskId, tabs] of this.tabActivity) {
      for (const [tabId, entry] of tabs) out.push(this.payload(taskId, entry.effective, tabId))
    }
    return out
  }

  /**
   * Raw diagnostic dump for `kobe api inspect` — see
   * {@link buildActivityDebugSnapshot} for what it shows and why it is not
   * the wire payload.
   */
  debugSnapshot(): ActivityDebugSnapshot {
    return buildActivityDebugSnapshot(this.activity, this.tabActivity)
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
  }

  private publishIdle(taskId: string): void {
    const previous = this.activity.get(taskId)
    if (previous?.lapse) clearTimeout(previous.lapse)
    const entry: ActivityEntry = { state: "idle", at: this.now() }
    this.activity.set(taskId, entry)
    this.bus.publish("engine-state", this.payload(taskId, entry))
  }

  private payload(taskId: string, entry: PayloadSource, tabId?: string): EngineStatePayload {
    return {
      taskId,
      ...(tabId ? { tabId } : {}),
      state: entry.state,
      ...(entry.detail ? { detail: entry.detail } : {}),
      ...(entry.session ? { sessionId: entry.session.id } : {}),
      ...(entry.session?.transcriptPath ? { transcriptPath: entry.session.transcriptPath } : {}),
      at: entry.at,
    }
  }
}

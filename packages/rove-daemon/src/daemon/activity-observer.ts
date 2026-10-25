/**
 * Daemon-side ground truth behind the sidebar running dots. Hooks lie by
 * omission (ESC fires no hook, a daemon restart wipes the registry, a dead
 * engine leaves its last claim standing); this loop closes those gaps from:
 *
 *   - `pty.list` every poll: OSC title + total output bytes. Movement inside
 *     the silence window ⇒ WORKING; both frozen for the window ⇒ rest.
 *     Engines repaint at ≥1Hz mid-turn (a long "thinking" phase still
 *     animates its title), so the threshold is ~30× any working gap.
 *   - `titleTurnHint`: claude writes ⠂/⠐ working and a static ✳ at rest,
 *     codex only decorates while working — a resting title is an event-grade
 *     "not working". No declared vocabulary → null → pure silence (never rest).
 *   - a low-frequency foreground WALK (`ps` tree, as `rove api inspect`):
 *     which engine runs in each session. Walk evidence gates every claim;
 *     "no engine" proves a `running` claim stale.
 *
 * The walk's vendor→no-engine EDGE is the only place an engine death inside
 * a still-living PTY is observable: the shell wrapper reaps the engine and
 * `exec`s a fallback shell, so the session stays alive and the PTY exit hook
 * never fires. It is persisted via `onEngineExit`, with one walk cadence
 * (~60s) of latency — a sampler, not an event.
 *
 * Findings fold in via `observeTab` (hooks outrank observation; only a stale
 * hook `running` is corrected). With no subscriber the loop slows rather than
 * stops: a headless agent fleet is exactly who needs the death edge. The
 * first tick runs immediately with a walk, so a restart re-seeds busy dots
 * within seconds.
 */

import type { ProgramStatusEvent } from "./program-status-event"

import type { DaemonActivityRegistry } from "./activity-registry.ts"
import { logDaemonInfo } from "./crash-log.ts"

/** Poll cadence — bounds state-flip latency; `pty.list` is one local RPC. */
export const DEFAULT_OBSERVER_POLL_MS = 10_000
/**
 * Output AND title frozen this long ⇒ resting. Far beyond the ≥1Hz working
 * repaint, and ≥3 poll ticks so one missed poll can't flap the dot.
 */
export const DEFAULT_SILENCE_MS = 30_000
/** Walk cadence in ticks (~60s at the default poll — the foreground reconciler). */
export const DEFAULT_WALK_EVERY_TICKS = 6
/**
 * Tick cadence for the UNSUBSCRIBED lane (~60s at the default poll). A cost
 * control, not a correctness gate: skipping ticks outright would skip the
 * engine-death edge, leaving headless callers with no `layer:"engine"`
 * records. One `pty.list` a minute; a host with no live sessions does no
 * per-session work.
 */
export const DEFAULT_UNSUBSCRIBED_EVERY_TICKS = 6
/**
 * Never correct a hook-claimed `running` younger than this: at a turn
 * boundary the title/output evidence can trail the hook by one poll, and a
 * fresh turn must not be idled by a stale observation.
 */
export const DEFAULT_CORRECT_AFTER_MS = 20_000
/** The banner's text inside a `keepAlive` launch script (`engine/session-launch.ts`). */
const WRAPPED_LAUNCH_MARK = "Engine exited (code"

/** One `pty.list` row the observer consumes. */
export interface ObservedPtySession {
  readonly programStatusEvent?: ProgramStatusEvent
  readonly key: string
  readonly alive: boolean
  readonly pid: number | null
  readonly title: string
  /** Monotonic total bytes the child ever wrote — the output heartbeat. */
  readonly totalBytes: number
  /** A freeze-restored session not yet reopened (`row-status-store.ts`). */
  readonly restored?: boolean
  /** Spawn argv; only a wrapped engine launch carries the banner's `printf`. */
  readonly command?: readonly string[]
  /** The host's incarnation token (`pty.list`); absent on hosts that predate it. */
  readonly generation?: string
}

export interface ActivityObserverIo {
  onProgramStatusEvent?(event: ProgramStatusEvent): void | Promise<void>
  /** Current pty-host inventory; `null` when the host is unreachable
   *  (never spawns one). */
  listSessions(): Promise<readonly ObservedPtySession[] | null>
  /** Foreground engine per session pid (ONE `ps` snapshot walk) — the
   *  engine's vendor + its own pid, or null for "no engine in this tree". */
  foregroundEngines(pids: readonly number[]): Promise<ReadonlyMap<number, { vendor: string; pid: number } | null>>
  /** Engine-owned title verdict — see rove's `engineTitleTurnHint`. */
  titleTurnHint(vendor: string, title: string): "working" | "rest" | null
  /**
   * Naming evidence per ALIVE, WALKED session (tier-b protocol sniff), once
   * per tick. The consumer owns eligibility and must never feed it back into
   * activity claims: a sniff names an engine, it does not resurrect a dot.
   */
  onEngineEvidence?(
    taskId: string,
    tabId: string,
    evidence: { readonly walkVendor: string | null; readonly title: string },
  ): void | Promise<void>
  /**
   * An engine vanished from a session whose PTY is STILL ALIVE (the PTY exit
   * hook's blind spot). Once per vendor→no-engine transition; never for a
   * session never walked with an engine.
   */
  onEngineExit?(info: {
    taskId: string
    tabId: string
    /** The PTY session's own key: `taskId` is its owner, which for a migrated child is not the key's prefix. */
    key: string
    vendor: string
    pid: number | null
  }): void | Promise<void>
  /**
   * A live session had NO engine on this daemon's first walk, so no
   * vendor→null edge exists: whatever died there died unwatched. Once per
   * pre-existing session, boot walk only. The loop can't tell that from a
   * never-started engine; the consumer judges (it reads the session's ring).
   */
  onEngineAbsentAtStart?(info: { taskId: string; tabId: string; key: string }): void | Promise<void>
  /**
   * A wrapped engine launch (the argv carries keepAlive's banner) born under this daemon and still
   * showing no engine: read what it printed since `sinceOffset` for the wrapper's `Engine exited`
   * banner. A launch that dies at once (command not found) never walks as an engine, so no
   * vendor→null edge exists for it. Resolves the offset to resume from, and whether a death was
   * recorded (the loop then stops asking); null = could not look.
   */
  scanEngineExitBanner?(info: {
    taskId: string
    tabId: string
    key: string
    sinceOffset: number
  }): Promise<{ offset: number; died: boolean } | null>
}

export interface ActivityObserverOptions {
  readonly pollMs?: number
  readonly silenceMs?: number
  readonly walkEveryTicks?: number
  /** Tick cadence when nothing is subscribed. See
   *  {@link DEFAULT_UNSUBSCRIBED_EVERY_TICKS}; 1 makes every tick run. */
  readonly unsubscribedEveryTicks?: number
  readonly correctAfterMs?: number
  readonly log?: (event: string, message: string) => void
  /** The task whose conversation a PTY is, from its key: a migrated child owns its parent-keyed PTY. Default: the key's task. */
  readonly ownerOf?: (taskId: string, tabId: string) => string
}

interface SessionTrack {
  /** The owning task (see {@link ActivityObserverOptions.ownerOf}); `key` is the session's own. */
  readonly taskId: string
  readonly key: string
  readonly tabId: string
  firstSeenAt: number
  lastTotalBytes: number
  lastTitle: string
  /** Last time bytes advanced OR the title changed; null until the first
   *  OBSERVED change, so an idle engine with no title vocabulary reads
   *  unknown rather than running for the first silence window. */
  lastActivityAt: number | null
  /** Last walk verdict: vendor id, null = no engine, undefined = never walked. */
  vendor: string | null | undefined
  /** ENGINE pid from the last walk (what a death record names), not the
   *  longer-lived session pid; null while no engine runs. */
  enginePid: number | null
  /** The host's incarnation token for this session; a different one under the same key is a new child. */
  generation?: string
  /** A launch wrapped by `keepAlive` that has shown no engine since it was born here: where the next
   *  banner scan resumes, and the byte count the last scan saw (the banner is output, so a quiet ring
   *  needs no rescan). Absent once an engine shows or the death is recorded. */
  bannerWatch?: { offset: number; scannedBytes: number }
}

/**
 * Start the loop; the first tick fires immediately with a walk. `hasSubscribers`
 * picks the CADENCE (every tick vs every `unsubscribedEveryTicks`), not whether
 * it runs. Returns stop().
 */
export function startActivityObserver(
  activity: DaemonActivityRegistry,
  io: ActivityObserverIo,
  hasSubscribers: () => boolean,
  options: ActivityObserverOptions = {},
): () => Promise<void> {
  const pollMs = options.pollMs ?? DEFAULT_OBSERVER_POLL_MS
  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS
  const walkEvery = Math.max(1, options.walkEveryTicks ?? DEFAULT_WALK_EVERY_TICKS)
  const unsubscribedEvery = Math.max(1, options.unsubscribedEveryTicks ?? DEFAULT_UNSUBSCRIBED_EVERY_TICKS)
  const correctAfterMs = options.correctAfterMs ?? DEFAULT_CORRECT_AFTER_MS
  const log = options.log ?? logDaemonInfo
  const ownerOf = options.ownerOf ?? ((taskId: string) => taskId)
  const tracks = new Map<string, SessionTrack>()
  let tickCount = 0
  let unsubscribedTicks = 0
  let inFlight: Promise<void> | undefined
  let stopped = false
  /** Has a walk ever RESOLVED verdicts here. Only on that first one does every
   *  listed session predate this daemon, so "no engine, never walked" means
   *  "died before us", not "starting". Not `tickCount === 0`: an unreachable
   *  host on the first tick must not burn the boot walk. */
  let bootWalkDone = false
  /** A `pty.list` answered on an earlier tick: a session first listed now was born under this daemon. */
  let listedBefore = false
  /** Where a freeze-restored corpse's ring ends: its respawned child's own output starts there. */
  const corpseEnd = new Map<string, number>()

  const applyRest = (track: Pick<SessionTrack, "taskId" | "tabId" | "vendor">, why: string): void => {
    const outcome = activity.observeTab(track.taskId, track.tabId, "rest", {
      ...(track.vendor ? { vendor: track.vendor } : {}),
      correctHookRunningAfterMs: correctAfterMs,
    })
    if (outcome === "corrected-hook-running") {
      log("activity-observe", `idled hook-claimed running for ${track.taskId}/${track.tabId} (${why})`)
    }
  }

  const tick = async (): Promise<void> => {
    const effects: Array<void | Promise<void>> = []
    try {
      // Two lanes, not a gate: the slow lane still walks every time, because
      // the engine-death edge below is the only report of an engine dying in
      // a live PTY. A host owning nothing lists `[]`, so the loops are empty.
      const subscribed = hasSubscribers()
      if (!subscribed && unsubscribedTicks++ % unsubscribedEvery !== 0) return
      const walkTick = !subscribed || tickCount % walkEvery === 0
      tickCount++
      const listed = await io.listSessions()
      if (stopped) return
      if (listed === null) {
        // Host unreachable is NOT evidence against hook claims: retire only
        // observed-running (no `correctHookRunningAfterMs` → hook entries stand).
        // Tracks survive the outage — they hold the only clock that can refute
        // a title frame; dropping them would restart silence at now and let a
        // dead engine's frozen spinner glyph re-light the dot every outage.
        // Tracks retire on EVIDENCE (`alive: false`, or missing from a list
        // that answered), never on our own blindness.
        for (const track of tracks.values()) {
          activity.observeTab(track.taskId, track.tabId, "rest", {})
        }
        return
      }
      const sessions = listed
      const seen = new Set<string>()

      // 2-segment `taskId::tabId` keys only; `::leaf-N` split leaves carry no tab state.
      const now = Date.now()
      const live: SessionTrack[] = []
      const newborn = new Set<string>()
      for (const s of sessions) {
        const parts = s.key.split("::")
        if (parts.length !== 2 || !parts[0] || !parts[1]) continue
        seen.add(s.key)
        if (!s.alive) {
          if (s.restored) corpseEnd.set(s.key, s.totalBytes)
          // Exited is positive evidence even if never tracked alive: a stale hook `running` still gets corrected.
          const track = tracks.get(s.key)
          applyRest(
            track ?? { taskId: ownerOf(parts[0], parts[1]), tabId: parts[1], vendor: undefined },
            "session exited",
          )
          tracks.delete(s.key)
          continue
        }
        const known = tracks.get(s.key)
        // Retry kills and reopens a key within one poll: a new child, so it is tracked afresh.
        if (known?.generation !== undefined && s.generation !== undefined && known.generation !== s.generation) {
          // The old child's death claim has nothing to say about the new one.
          activity.retireEngineDeath(known.taskId, known.tabId, now)
          tracks.delete(s.key)
        }
        let track = tracks.get(s.key)
        if (!track) {
          track = {
            taskId: ownerOf(parts[0], parts[1]),
            key: s.key,
            tabId: parts[1],
            firstSeenAt: now,
            lastTotalBytes: s.totalBytes,
            lastTitle: s.title,
            lastActivityAt: null,
            vendor: undefined,
            enginePid: null,
            generation: s.generation,
          }
          tracks.set(s.key, track)
          newborn.add(s.key)
          if (s.command?.some((arg) => arg.includes(WRAPPED_LAUNCH_MARK))) {
            // Born under this daemon: its whole output (since the corpse it respawned, if any) is the new child's.
            // Listed first now (an earlier daemon's, or born while the host was still coming up): what it already
            // printed is the boot reconciler's, so only later output is scanned.
            track.bannerWatch = listedBefore
              ? { offset: corpseEnd.get(s.key) ?? 0, scannedBytes: -1 }
              : { offset: s.totalBytes, scannedBytes: s.totalBytes }
          }
          corpseEnd.delete(s.key)
        } else if (s.totalBytes !== track.lastTotalBytes || s.title !== track.lastTitle) {
          track.lastTotalBytes = s.totalBytes
          track.lastTitle = s.title
          track.lastActivityAt = now
        }
        live.push(track)
      }
      listedBefore = true

      // Dead or vanished: retire observed claims AND stale hook `running`s.
      for (const [key, track] of tracks) {
        if (seen.has(key) && sessions.some((s) => s.key === key && s.alive)) continue
        applyRest(track, "session gone")
        tracks.delete(key)
      }

      // Walk every `walkEvery` ticks, plus immediately for new or never-walked sessions.
      const toWalk = live.filter((t) => walkTick || newborn.has(t.key) || t.vendor === undefined)
      if (toWalk.length > 0) {
        const pidByKey = new Map<string, number>()
        for (const s of sessions) {
          if (s.alive && s.pid !== null) pidByKey.set(s.key, s.pid)
        }
        try {
          const pids = toWalk.map((t) => pidByKey.get(t.key)).filter((pid): pid is number => pid !== undefined)
          const verdicts = await io.foregroundEngines(pids)
          if (stopped) return
          const bootWalk = !bootWalkDone
          bootWalkDone = true
          for (const track of toWalk) {
            const pid = pidByKey.get(track.key)
            if (pid === undefined || !verdicts.has(pid)) continue
            const found = verdicts.get(pid) ?? null
            // Engine-death edge: no engine where the last walk saw one, session
            // still alive — invisible to the PTY exit hook. `enginePid` is the
            // dead engine's pid from the last walk that still saw it.
            if (found === null && typeof track.vendor === "string") {
              effects.push(
                io.onEngineExit?.({
                  taskId: track.taskId,
                  tabId: track.tabId,
                  key: track.key,
                  vendor: track.vendor,
                  pid: track.enginePid,
                }),
              )
            } else if (found === null && track.vendor === undefined && bootWalk) {
              // Never walked, no engine: tracks start at `vendor: undefined`, so
              // no edge will ever fire. The consumer judges whether one died.
              effects.push(io.onEngineAbsentAtStart?.({ taskId: track.taskId, tabId: track.tabId, key: track.key }))
            }
            track.vendor = found?.vendor ?? null
            track.enginePid = found?.pid ?? null
            if (found) {
              track.bannerWatch = undefined
              // An engine runs here: whatever death was recorded for the tab is history.
              activity.retireEngineDeath(track.taskId, track.tabId, now)
            }
          }
        } catch {
          // ps failed: keep prior verdicts; never-walked sessions stay unclaimed.
        }
      }

      // A wrapped launch that never showed an engine leaves one trace: the wrapper's own banner.
      for (const track of live) {
        const watch = track.bannerWatch
        if (!watch || watch.scannedBytes === track.lastTotalBytes) continue
        watch.scannedBytes = track.lastTotalBytes
        const scan = io.scanEngineExitBanner?.({
          taskId: track.taskId,
          tabId: track.tabId,
          key: track.key,
          sinceOffset: watch.offset,
        })
        if (!scan) continue
        effects.push(
          scan.then((result) => {
            if (!result) {
              watch.scannedBytes = -1
              return
            }
            if (result.died) track.bannerWatch = undefined
            else watch.offset = result.offset
          }),
        )
      }

      if (stopped) return
      // Claims. Unwalked → no claim (the client's "unknown", not idle). Walked
      // precedence: resting title → rest; movement inside the window →
      // working; WORKING title frame → working until silence proves it frozen
      // (restart seeding: a busy claude re-lights off ⠂/⠐ alone); full
      // silence → rest; quiet, never moved, no verdict → unknown.
      for (const track of live) {
        const key = track.key
        const session = sessions.find((s) => s.key === key)
        if (!session || track.vendor === undefined) continue
        effects.push(
          io.onEngineEvidence?.(track.taskId, track.tabId, { walkVendor: track.vendor, title: session.title }),
        )
        if (session.programStatusEvent && io.onProgramStatusEvent) {
          effects.push(io.onProgramStatusEvent(session.programStatusEvent))
          if (session.programStatusEvent.status !== null) continue
        }
        if (track.vendor === null) {
          // No foreground engine corrects a stale hook `running`, but is NOT the
          // death badge (quitting an agent on purpose leaves an idle tab). `dead`
          // comes from the exit RECORD (pty-exit-watch.ts, exit code + error
          // text); arbitration rule 0 keeps it from being dimmed here.
          applyRest(track, "no engine in foreground")
          continue
        }
        const silentForMs = now - (track.lastActivityAt ?? track.firstSeenAt)
        const hint = io.titleTurnHint(track.vendor, session.title)
        const claimWorking = (why: string): void => {
          const outcome = activity.observeTab(track.taskId, track.tabId, "working", {
            vendor: track.vendor ?? undefined,
          })
          if (outcome === "observed-running") {
            log("activity-observe", `seeded running for ${track.taskId}/${track.tabId} (${why})`)
          }
        }
        if (hint === "rest") applyRest(track, "engine title at rest")
        else if (track.lastActivityAt !== null && now - track.lastActivityAt < silenceMs) claimWorking("live output")
        else if (hint === "working" && silentForMs < silenceMs) claimWorking("working title frame")
        else if (silentForMs >= silenceMs) applyRest(track, `no output for ${Math.round(silentForMs / 1000)}s`)
        // else: quiet, never moved, no verdict — stays unknown.
      }
    } catch {
      // Observation is best-effort; a failed tick must never hurt the daemon.
    } finally {
      await Promise.allSettled(effects)
    }
  }

  const schedule = (): void => {
    if (stopped || inFlight) return
    inFlight = tick().finally(() => {
      inFlight = undefined
    })
  }
  schedule()
  const timer = setInterval(schedule, pollMs)
  timer.unref?.()
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}

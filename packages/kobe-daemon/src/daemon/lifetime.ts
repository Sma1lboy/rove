/**
 * DaemonLifetime — "should the daemon, and its collectors, still run?" One
 * policy keyed on which front-ends are attached. (`lifecycle.ts` is different:
 * it kills an EXTERNAL daemon process.)
 *
 *  1. **Lazy shutdown** — lifetime is bound to `role: "gui"` subscribers
 *     (`holdsLifetime`). The LAST gui leaving arms a short grace, then
 *     self-stop. Armed only on a >0 → 0 gui transition (never on boot), so a
 *     gui-less `kobe daemon start` / respawned `daemon restart` stays up. A gui
 *     (re)attach cancels the grace; a pane subscribing during it must NOT.
 *  2. **Collector gate** — background collectors (worktree-changes,
 *     auto-title) pause while nobody (gui OR pane) is subscribed.
 *  3. **Stopping** — once teardown begins, neither rule may re-fire.
 *
 * Truth is the server's live `clients` set, scanned on demand, so no counter
 * can drift with re-subscribes, role changes, or unsubscribed closes. This
 * module owns only the timer, the `stopping` flag, and the arm/cancel rules,
 * with an injectable clock.
 */

import { readRoveEnv } from "../compat-env.ts"
import type { ChannelName } from "./channels.ts"
import { logDaemonInfo } from "./crash-log.ts"

/** The slice of a client this policy reads; `ClientState` satisfies it structurally. */
export interface LifetimeClient {
  readonly subscribed: boolean
  readonly holdsLifetime: boolean
  /**
   * Per-channel subscribe filter; `null` or absent (web clients) = every
   * channel. Read by {@link DaemonLifetime.hasSubscribersFor}.
   */
  readonly channels?: ReadonlySet<ChannelName> | null
}

/**
 * Grace before a gui-less daemon self-stops. Absorbs reconnect races
 * (`manualReconnect()` force-disconnects then re-subscribes, briefly dropping
 * to zero). Override via `ROVE_DAEMON_IDLE_GRACE_MS`.
 */
const DEFAULT_IDLE_GRACE_MS = 3000

/** First-gui window for AUTOSPAWNED daemons (`KOBE_DAEMON_AUTOSPAWNED`): long
 *  enough for a slow TUI boot, short enough that a daemon born from a stray
 *  `kobe api` in an engine tab never lingers as a zombie holding the socket. */
export const FIRST_GUI_GRACE_MS = 60_000

export function resolveIdleGraceMs(): number {
  const raw = readRoveEnv("DAEMON_IDLE_GRACE_MS")
  if (raw === undefined) return DEFAULT_IDLE_GRACE_MS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_IDLE_GRACE_MS
}

/** Schedule `fn` after `ms`; returns a cancel. The default is an unref'd
 *  `setTimeout`, so a pending grace never keeps the process alive. */
export type ScheduleFn = (fn: () => void, ms: number) => () => void

const defaultSchedule: ScheduleFn = (fn, ms) => {
  const t = setTimeout(fn, ms)
  t.unref?.()
  return () => clearTimeout(t)
}

export interface DaemonLifetimeOptions {
  /** The live set of connected clients — scanned on demand (no cached count). */
  readonly clients: () => Iterable<LifetimeClient>
  /** Grace before a gui-less daemon self-stops. */
  readonly idleGraceMs: number
  /** Invoked once when the grace elapses with still-zero guis. */
  readonly onIdleStop: () => void
  /**
   * Also arm a BOOT-time grace: no gui within this window → self-stop. For
   * AUTOSPAWNED daemons only (`KOBE_DAEMON_AUTOSPAWNED`, set by
   * `connectOrStartDaemon`'s spawn): without a >0 → 0 gui drop the normal rule
   * never fires, so one whose client never attached as a gui would live
   * forever. A deliberate `kobe daemon start` doesn't set the flag and stays up.
   */
  readonly firstGuiGraceMs?: number
  /**
   * Non-gui reason to stay alive, even with zero guis. For scheduled
   * Automations (a schedule that only fires while someone watches isn't one);
   * releases when the last one is deleted or disabled.
   */
  readonly keepAlive?: () => boolean
  /** Timer factory (default: unref'd setTimeout); injected by tests. */
  readonly schedule?: ScheduleFn
  /** Structured log sink (default: {@link logDaemonInfo}); injected by tests. */
  readonly log?: (event: string, message: string) => void
}

export class DaemonLifetime {
  private readonly clients: () => Iterable<LifetimeClient>
  private readonly idleGraceMs: number
  private readonly onIdleStop: () => void
  private readonly schedule: ScheduleFn
  private readonly log: (event: string, message: string) => void
  private readonly keepAlive: () => boolean
  private cancelIdle: (() => void) | null = null
  private stopping = false

  constructor(options: DaemonLifetimeOptions) {
    this.clients = options.clients
    this.idleGraceMs = options.idleGraceMs
    this.onIdleStop = options.onIdleStop
    this.schedule = options.schedule ?? defaultSchedule
    this.log = options.log ?? logDaemonInfo
    this.keepAlive = options.keepAlive ?? (() => false)
    // The first guiAttached() cancels this; afterwards only the normal
    // >0 → 0 transition arms shutdown.
    const bootGrace = options.firstGuiGraceMs
    if (bootGrace !== undefined) {
      this.log("idle", `autospawned — arming ${bootGrace}ms first-gui grace`)
      this.cancelIdle = this.schedule(() => {
        this.cancelIdle = null
        if (this.shouldStayUp()) return
        this.log("idle", "first-gui grace elapsed with no gui — self-stopping")
        this.onIdleStop()
      }, bootGrace)
    }
  }

  /** The lazy-shutdown refcount: `holdsLifetime` (gui) clients only, not panes. */
  guiCount(): number {
    let n = 0
    for (const c of this.clients()) if (c.holdsLifetime) n++
    return n
  }

  /** Any subscribed consumer (gui OR pane), whatever the filter. Collectors
   *  use {@link hasSubscribersFor} instead. */
  hasSubscribers(): boolean {
    for (const c of this.clients()) if (c.subscribed) return true
    return false
  }

  /**
   * Collector gate, per channel: would any subscriber actually RECEIVE this?
   *
   * Mirrors the filter `broadcast` honours: a pane subscribed to only
   * `["ui-prefs", "keybindings"]` must not start every collector (measured: 194
   * `git` spawns in 8s to deliver frames it never receives). One walk of the
   * client set per call, once per collector tick.
   */
  hasSubscribersFor(channel: ChannelName): boolean {
    for (const c of this.clients()) {
      if (!c.subscribed) continue
      if (!c.channels || c.channels.has(channel)) return true
    }
    return false
  }

  /** True once teardown has begun; suppresses any further arm/fire. */
  isStopping(): boolean {
    return this.stopping
  }

  /** Mark teardown as begun and cancel any pending grace. Idempotent. */
  markStopping(): void {
    this.stopping = true
    this.clearIdle()
  }

  /** Cancel any pending grace. A pane must NOT call this: a pane connecting
   *  during the grace leaves the countdown running. */
  guiAttached(): void {
    this.clearIdle()
  }

  /** Only a gui drop can arm the grace; panes and CLI pokes never trip shutdown. */
  clientDisconnected(wasGui: boolean): void {
    if (wasGui) this.maybeArm()
  }

  /**
   * Re-check after a KEEP-ALIVE hold may have gone away. Arming is otherwise
   * driven only by gui disconnects, so deleting the last schedule after the
   * last gui left would go unnoticed. Call when mutating a keep-alive source.
   */
  reevaluateIdle(): void {
    this.maybeArm()
  }

  private clearIdle(): void {
    if (this.cancelIdle) {
      this.cancelIdle()
      this.cancelIdle = null
    }
  }

  /** Every reason NOT to self-stop. Checked at arm time AND when the timer
   *  fires, since a hold can appear or vanish during the grace. */
  private shouldStayUp(): boolean {
    if (this.stopping || this.guiCount() > 0) return true
    if (!this.keepAlive()) return false
    this.log("idle", "no gui, but a keep-alive hold is active — staying up")
    return true
  }

  private maybeArm(): void {
    if (this.shouldStayUp()) return
    this.clearIdle()
    this.log("idle", `last gui gone — arming ${this.idleGraceMs}ms idle-stop grace`)
    this.cancelIdle = this.schedule(() => {
      this.cancelIdle = null
      if (this.shouldStayUp()) return
      this.log("idle", "grace elapsed with no gui — self-stopping")
      this.onIdleStop()
    }, this.idleGraceMs)
  }
}

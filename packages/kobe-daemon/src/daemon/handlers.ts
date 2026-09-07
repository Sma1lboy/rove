/**
 * Daemon RPC handler registry.
 *
 * Every {@link DaemonRequestName} is a self-contained entry —
 * `{ name, handle(payload, ctx) }` — keyed in a registry map, so the dispatch
 * seam is: look up entry → validate (the shared `requireString`-family
 * helpers) → handle → uniform error shaping
 * ({@link shapeDaemonError}, the ONE place a thrown error becomes a
 * {@link DaemonError}).
 *
 * Hard constraint: WIRE COMPATIBILITY. Socket clients and the daemon web
 * transport parse these payload shapes, so an entry may never reshape one.
 * Success payload KEY ORDER is load-bearing for byte equality
 * (`JSON.stringify` preserves insertion order), so handlers return exact
 * literal shapes, `{}` returns included. Error message wording is part of the contract too
 * (`"${key} is required"`, `"unknown daemon request: …"`).
 *
 * One request is deliberately NOT here: `subscribe`. It is connection
 * lifecycle, not RPC — it mutates per-socket state (`subscribed`,
 * `holdsLifetime`), drives the gui-refcount idle-grace timer, and writes
 * event frames directly to the socket out-of-band (channel replay). The
 * registry's payload→result shape cannot express any of that, so it stays
 * special-cased in `server.ts` next to the machinery it manipulates.
 *
 * Everything a handler needs from the daemon process arrives via
 * {@link DaemonHandlerContext}, so a test can build the registry and dispatch
 * a request against a fake Orchestrator with NO socket involved (see
 * `packages/kobe/test/daemon/handlers.test.ts`).
 */

import type { DaemonRpcClient } from "../client/rpc.ts"
import type { DaemonActivityRegistry } from "./activity-registry.ts"
import type { AgentTurnsStore } from "./agent-turns-store.ts"
import type { AttentionInboxStore } from "./attention-inbox.ts"
import type { AutomationsStore } from "./automations-store.ts"
import type { ChannelName } from "./channels.ts"
import type { DaemonOrchestrator } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { objectPayload, optionalActivityDetail, optionalString, requireString } from "./handler-validators.ts"
import { AGENT_TURN_HANDLERS } from "./handlers-agent-turns.ts"
import { ATTENTION_HANDLERS } from "./handlers-attention.ts"
import { AUTOMATION_HANDLERS } from "./handlers-automations.ts"
import { ENGINE_REPORT_HANDLER } from "./handlers-engine-report.ts"
import { ISSUE_HANDLERS } from "./handlers-issues.ts"
import { PR_HANDLERS } from "./handlers-pr.ts"
import { TASK_HANDLERS } from "./handlers-task.ts"
import { UI_HANDLERS } from "./handlers-ui.ts"
import { WORK_ITEM_HANDLERS } from "./handlers-work-items.ts"
import { WORKTREE_HANDLERS } from "./handlers-worktree.ts"
import type { IssuesStore } from "./issues-store.ts"
import type { NotesStore } from "./notes-store.ts"
import {
  CHANNEL_NAMES,
  DAEMON_PROTOCOL_VERSION,
  type DaemonError,
  type DaemonRequestName,
  type DaemonStopReason,
  MIN_COMPATIBLE_PROTOCOL_VERSION,
  isProtocolCompatible,
  parseDaemonStopReason,
  serializeTask,
} from "./protocol.ts"
import type { QuotaUsageCache } from "./quota-usage-cache.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import type { TabCloseBroker } from "./tab-close-broker.ts"
import type { TaskDeletionScheduler } from "./task-deletion-runner.ts"
import type { WorkItemCache } from "./work-items.ts"

// Re-exported for backward compatibility — `server.ts` and (transitively)
// `packages/kobe/test/daemon/handlers.test.ts` import these from here.
export {
  objectPayload,
  optionalActivityDetail,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalVendor,
  requireString,
} from "./handler-validators.ts"

/**
 * Everything a request handler may touch, threaded in by the caller per
 * dispatch. `server.ts` builds it from its closure; a test builds it from
 * fakes. Handlers themselves are stateless — ALL daemon state reaches them
 * through this context.
 */
export interface DaemonHandlerContext {
  /** Task-lifecycle owner — the single writer for the task index. */
  readonly orch: DaemonOrchestrator
  /** Product/runtime behavior supplied by the kobe composition root. */
  readonly runtime: DaemonRuntimeAdapter
  /** Push-channel hub (`task.setActive` publishes `active-task` here). */
  readonly bus: DaemonEventBus
  /** Transient engine-activity state (`engine.reportEvent`, `task.delete`). */
  readonly activity: DaemonActivityRegistry
  /** Durable attention episodes; independent from transient activity cleanup. */
  readonly inbox: AttentionInboxStore
  /** Starts deduplicated durable background deletion after RPC acceptance. */
  readonly deletions: TaskDeletionScheduler
  /** Daemon-owned issue tracker store, keyed by git common-dir. */
  readonly issues: IssuesStore
  /** Durable field notes, same key convention (absent in older tests). */
  readonly notes?: NotesStore
  /** Short-TTL cache over external tracker items (read-only view). */
  readonly workItems: WorkItemCache
  /** Daemon-owned scheduled automations + their run history. */
  readonly automations: AutomationsStore
  /** In-process RPC client for handlers that must drive the daemon's own
   *  request surface (the automation runner's engine launch). */
  readonly selfLink: DaemonRpcClient
  /** Rate-limited cache in front of the engine quota probes. */
  readonly quotaUsage: QuotaUsageCache
  /** Durable per-turn telemetry (absent in older tests). */
  readonly agentTurns?: AgentTurnsStore
  /** Per-task recent engine events (`task.recentEvents`; absent in older tests). */
  readonly engineEvents?: import("./engine-events-log.ts").EngineEventLog
  /** Pending host-dialog prompts (`ui.prompt` / `ui.promptReply`). */
  readonly prompts?: import("./prompt-broker.ts").PromptBroker
  /** Pending exact Terminal Tab closes awaiting a TUI acknowledgement. */
  readonly tabCloses?: TabCloseBroker
  /** Plugin sink for agent-lifecycle events — a direct feed, deliberately NOT a bus channel. */
  readonly plugins?: Pick<import("../plugins/runtime.ts").PluginHost, "handleEngineReport" | "handleUiReport">
  /** Daemon-process facts + lifecycle controls handlers surface or drive. */
  readonly daemon: {
    readonly startedAt: Date
    readonly socketPath: string
    /** The state root this daemon serves (`<homeDir>/.kobe`). Reported by
     *  `hello` so a client can detect a daemon from a DIFFERENT home sitting
     *  on its socket — a sandbox/dev daemon that inherited the production
     *  socket path serves an EMPTY task index, which the TUI would otherwise
     *  render as a legitimate "you have no tasks". */
    readonly homeDir?: string
    /** Loopback web transport port, when this daemon is exposing browser routes. */
    /** Why the web transport isn't listening (port taken / bind failed), or
     *  null when it's up or was never requested. Reported by `daemon.status`
     *  so a socket-only degrade shows the real reason, not a generic error. */
    /** The daemon process pid (reported by `hello` / `daemon.status`). */
    readonly pid: number
    /** Attached-GUI refcount (reported as `attachedClients`). */
    guiCount(): number
    /** Every attached client, GUI or pane. `session.deliver` is performed by
     *  whichever client hosts the session, so this — not the GUI refcount —
     *  is what says a dispatch could reach anyone. */
    clientCount(): number
    /** Is anyone subscribed who would actually RECEIVE a publish on this
     *  channel? The same per-channel gate the background collectors use, so a
     *  handler can skip building a payload nobody is listening for. Absent in
     *  older test doubles — treat `undefined` as "publish anyway". */
    hasSubscribersFor?(channel: ChannelName): boolean
    /** Graceful self-stop (`daemon.stop`). The reason rides out on the
     *  `daemon.stopping` broadcast — see {@link DaemonStopReason}. */
    stopSoon(reason?: DaemonStopReason): Promise<void>
    /** Re-check idle shutdown after a keep-alive hold may have been released
     *  (the last automation was disabled or deleted with no gui attached). */
    reevaluateIdle(): void
  }
  /** The requesting connection's id (`hello` echoes it back as `clientId`). */
  readonly clientId: number
}

/**
 * One registry entry — a self-contained RPC: payload validation (via the
 * shared `requireString`-family helpers) + the Orchestrator/daemon call.
 * Throwing is the error path; the caller shapes the thrown value with
 * {@link shapeDaemonError}. The returned value is the response frame's
 * `payload`, byte-for-byte.
 */
export interface DaemonRequestHandler {
  readonly name: DaemonRequestName
  /**
   * Can this verb legitimately outlive the client's 20s wedge deadline?
   * Declared on the entry itself, so the question is in front of whoever
   * writes the handler — the socket client cannot import this registry
   * (that would pull every daemon module into the CLI), so it reads the
   * mirror in `protocol.ts`. `test/daemon/rpc-deadline.test.ts` fails when
   * the two drift.
   */
  readonly blocking?: boolean
  handle(payload: Record<string, unknown>, ctx: DaemonHandlerContext): Promise<unknown> | unknown
}

/** The registry-derived blocking set: every entry marked `blocking: true`. */
export function blockingRpcNames(
  registry: ReadonlyMap<DaemonRequestName, DaemonRequestHandler>,
): ReadonlySet<DaemonRequestName> {
  const names = new Set<DaemonRequestName>()
  for (const entry of registry.values()) if (entry.blocking === true) names.add(entry.name)
  return names
}

/**
 * The ONE place a thrown error becomes an on-the-wire {@link DaemonError}.
 * Matches the pre-registry shaping exactly: `Error` instances carry their
 * `message` + `name` (a plain `Error` serializes as `name: "Error"`);
 * anything else is `String(…)`-coerced with `name` omitted (`undefined`
 * is dropped by `JSON.stringify`, so the key never hits the wire).
 *
 * NOT used by `server.ts`'s parse-error path, which historically sends a
 * bare `{ message }` with no `name` key even for `Error`s — shaping it here
 * would add `"name":"SyntaxError"` bytes to the wire.
 */
export function shapeDaemonError(err: unknown): DaemonError {
  return {
    message: err instanceof Error ? err.message : String(err),
    name: err instanceof Error ? err.name : undefined,
  }
}

/**
 * Look up + run the handler for `name`. The unknown-request error keeps the
 * switch's `default` wording exactly — a v2 client's removed `daemon.web.*`
 * requests (and any future-client request) must keep getting the same
 * `unknown daemon request: …` message.
 */
export async function dispatchDaemonRequest(
  registry: ReadonlyMap<DaemonRequestName, DaemonRequestHandler>,
  name: string,
  payload: unknown,
  ctx: DaemonHandlerContext,
): Promise<unknown> {
  const entry = registry.get(name as DaemonRequestName)
  if (!entry) throw new Error(`unknown daemon request: ${name}`)
  return entry.handle(objectPayload(payload), ctx)
}

/**
 * Build the registry. Handlers are stateless (state arrives via ctx), so the
 * map is safe to share across every connection of a server instance.
 */
export function createDaemonHandlerRegistry(): ReadonlyMap<DaemonRequestName, DaemonRequestHandler> {
  const entries: DaemonRequestHandler[] = [
    {
      name: "hello",
      handle(payload, ctx) {
        // Negotiate a compatibility RANGE (see protocol.ts isProtocolCompatible).
        // A client that omits a field is tolerated: a missing version means
        // "current", a missing min means "same as its version". Only a true
        // range mismatch is rejected, with a clear upgrade message.
        const clientVersion =
          typeof payload.protocolVersion === "number" ? payload.protocolVersion : DAEMON_PROTOCOL_VERSION
        const clientMin = typeof payload.minProtocolVersion === "number" ? payload.minProtocolVersion : clientVersion
        if (
          !isProtocolCompatible({
            localVersion: DAEMON_PROTOCOL_VERSION,
            localMin: MIN_COMPATIBLE_PROTOCOL_VERSION,
            remoteVersion: clientVersion,
            remoteMin: clientMin,
          })
        ) {
          throw new Error(
            `daemon is protocol v${DAEMON_PROTOCOL_VERSION} (min v${MIN_COMPATIBLE_PROTOCOL_VERSION}); this client is v${clientVersion} (min v${clientMin}). Upgrade Rove.`,
          )
        }
        return {
          protocolVersion: DAEMON_PROTOCOL_VERSION,
          minProtocolVersion: MIN_COMPATIBLE_PROTOCOL_VERSION,
          // The daemon's BUILD version (package.json). The protocol range above
          // only catches a breaking wire change; this lets the client detect a
          // stale-build daemon after a patch upgrade (same protocol, still
          // running the code it booted with) and surface a non-fatal "restart
          // the daemon" banner (KOB).
          kobeVersion: ctx.runtime.currentVersion,
          capabilities: [...CHANNEL_NAMES],
          daemonPid: ctx.daemon.pid,
          clientId: ctx.clientId,
          // The state root behind `tasks` below. A client whose own home
          // differs is talking to a foreign daemon (a sandbox one that
          // inherited the production socket path) and must reject the list
          // instead of rendering an empty sidebar — protocol.isForeignDaemonHome.
          homeDir: ctx.daemon.homeDir,
          tasks: ctx.orch.listTasks().map(serializeTask),
        }
      },
    },
    {
      name: "daemon.status",
      handle(_payload, ctx) {
        return {
          daemonPid: ctx.daemon.pid,
          // Build version of the running daemon (package.json) — surfaced in
          // `daemon status` / `kobe doctor` so a stale-build daemon is visible
          // even without a TUI attached (KOB).
          kobeVersion: ctx.runtime.currentVersion,
          uptimeMs: Date.now() - ctx.daemon.startedAt.getTime(),
          startedAt: ctx.daemon.startedAt.toISOString(),
          // Attached GUIs (role "gui" front-ends) — the refcount that keeps
          // the daemon alive. Excludes helper panes (role "pane") and
          // transient CLI pokes, so this reflects "humans looking at kobe".
          attachedClients: ctx.daemon.guiCount(),
          // Why this daemon may be up with zero attached clients. Without it,
          // a daemon staying alive for a schedule looks like a leak.
          automationHold: ctx.automations.hasEnabled(),
          taskCount: ctx.orch.listTasks().length,
          // The state root this daemon serves — `hello` already reports it for
          // the TUI's foreign-daemon guard; status carries it so `rove doctor`
          // can name a daemon squatting the socket from a DIFFERENT home,
          // which otherwise reads as "my tasks vanished".
          homeDir: ctx.daemon.homeDir,
          socketPath: ctx.daemon.socketPath,
        }
      },
    },
    {
      name: "daemon.stop",
      async handle(payload, ctx) {
        // `restart` is the only reason a caller may claim, and only
        // `daemon restart` (plus the TUI's refresh) claims it: it tells every
        // attached client the code is being swapped, not that the daemon is
        // done. Anything else — including an unset or unrecognized field —
        // reads as a plain `stop`, so a stale or hostile caller can never
        // make an ordinary shutdown look like an upgrade.
        const reason = parseDaemonStopReason(payload.reason) === "restart" ? "restart" : "stop"
        await ctx.daemon.stopSoon(reason)
        return {}
      },
    },
    // `task.*` (+ `project.forget`) and `worktree.*` live in their own files
    // (handlers-task.ts / handlers-worktree.ts), grouped by RPC-name prefix —
    // a file boundary, not a responsibility one. Entry ORDER here doesn't
    // affect any individual response's byte shape (only within-object key
    // order is wire-load-bearing), so grouping them via spread is safe.
    ...TASK_HANDLERS,
    ...WORKTREE_HANDLERS,
    ...ATTENTION_HANDLERS,
    ...AUTOMATION_HANDLERS,
    ...WORK_ITEM_HANDLERS,
    ...AGENT_TURN_HANDLERS,
    ...UI_HANDLERS,
    ...ISSUE_HANDLERS,
    ...PR_HANDLERS,
    {
      // Production diagnostics (`kobe api inspect`): what the daemon's
      // transient state ACTUALLY holds right now. Bug reports about badges,
      // idle-lapse, or identity need this raw view — the wire payloads are
      // projections that hide the fields (probe vendor, armed watchdogs)
      // those bugs usually hinge on. Read-only, no side effects.
      name: "debug.inspect",
      handle(_payload, ctx) {
        return {
          daemonPid: ctx.daemon.pid,
          kobeVersion: ctx.runtime.currentVersion,
          startedAt: ctx.daemon.startedAt.toISOString(),
          activity: ctx.activity.debugSnapshot(),
          attachedClients: ctx.daemon.guiCount(),
          // Total connections, GUI and pane. `session.deliver` (what `api
          // dispatch` publishes) is only ever PERFORMED by an attached
          // client, so 0 here proves a dispatch reached nobody while still
          // answering `ok: true` — the shape that makes "I answered it and
          // the badge never cleared" unreadable from every other field.
          // Non-zero is not proof of the converse: a calling CLI counts.
          connectedClients: ctx.daemon.clientCount(),
          // The context collector's current reading per live engine session
          // (`taskId::tabId`), token totals included. Same last-value the bus
          // replays to a late subscriber, so this answers "is the footer's
          // number stale, wrong, or absent" without opening a browser — and
          // it is the only read that shows the token counts at all.
          contextUsage:
            (
              ctx.bus.snapshot().find((event) => event.channel === "usage.context")?.payload as
                | { context?: unknown }
                | undefined
            )?.context ?? null,
        }
      },
    },
    {
      name: "task.recentEvents",
      async handle(payload, ctx) {
        const taskId = requireString(payload, "taskId")
        if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
        return { events: ctx.engineEvents?.recent(taskId) ?? [] }
      },
    },
    ENGINE_REPORT_HANDLER,
  ]
  return new Map(entries.map((entry) => [entry.name, entry]))
}

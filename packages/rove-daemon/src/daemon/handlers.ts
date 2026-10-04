/**
 * Daemon RPC handler registry: look up entry → validate → handle → shape
 * errors via {@link shapeDaemonError}, the ONE place a thrown error becomes a
 * {@link DaemonError}.
 *
 * WIRE COMPATIBILITY: socket clients and the web transport parse these
 * payloads. Success KEY ORDER is load-bearing for byte equality, so handlers
 * return exact literal shapes (`{}` included). Error wording is contract too
 * (`"${key} is required"`, `"unknown daemon request: …"`).
 *
 * `subscribe` is deliberately NOT here: it mutates per-socket state, drives
 * the gui-refcount idle-grace timer, and writes replay frames out-of-band —
 * none of which fits payload→result — so it stays in `server.ts`.
 *
 * All daemon state arrives via {@link DaemonHandlerContext}, so tests dispatch
 * against fakes with no socket.
 */

import { hostname } from "node:os"
import type { DaemonRpcClient } from "../client/rpc.ts"
import type { DaemonActivityRegistry } from "./activity-registry.ts"
import type { AgentTurnsStore } from "./agent-turns-store.ts"
import type { AttentionInboxStore } from "./attention-inbox.ts"
import type { AutomationsStore } from "./automations-store.ts"
import type { ChannelName } from "./channels.ts"
import type { DaemonOrchestrator } from "./contracts.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { objectPayload, requireString } from "./handler-validators.ts"
import { AGENT_TURN_HANDLERS } from "./handlers-agent-turns.ts"
import { ATTENTION_HANDLERS } from "./handlers-attention.ts"
import { AUTOMATION_HANDLERS } from "./handlers-automations.ts"
import { ENGINE_REPORT_HANDLER } from "./handlers-engine-report.ts"
import { GRAPHICS_HANDLERS } from "./handlers-graphics.ts"
import { ISSUE_HANDLERS } from "./handlers-issues.ts"
import { PR_HANDLERS } from "./handlers-pr.ts"
import { TASK_HANDLERS } from "./handlers-task.ts"
import { UI_HANDLERS } from "./handlers-ui.ts"
import { WORK_ITEM_HANDLERS } from "./handlers-work-items.ts"
import { WORKTREE_HANDLERS } from "./handlers-worktree.ts"
import type { IssuesStore } from "./issues-store.ts"
import type { NotesStore } from "./notes-store.ts"
import { defaultPtyHostSocketPath } from "./paths.ts"
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

// `server.ts` and handlers.test.ts import these from here.
export {
  objectPayload,
  optionalActivityDetail,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalVendor,
  requireString,
} from "./handler-validators.ts"

/** Everything a handler may touch, per dispatch. Handlers are stateless — ALL daemon state arrives here. */
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
  /** In-memory, TTL-bounded plugin row tokens (absent in older test doubles). */
  readonly rowTokens?: import("./row-tokens.ts").RowTokenStore
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
  /** In-process RPC client into the daemon's own requests (automation engine launch). */
  readonly selfLink: DaemonRpcClient
  /** Rate-limited cache in front of the engine quota probes. */
  readonly quotaUsage: QuotaUsageCache
  /** Durable per-turn telemetry (absent in older tests). */
  readonly agentTurns?: AgentTurnsStore
  /** Per-task recent engine events (`task.recentEvents`; absent in older tests). */
  readonly engineEvents?: import("./engine-events-log.ts").EngineEventLog
  /** Pending host-dialog prompts (`ui.prompt` / `ui.promptReply`). */
  readonly prompts?: import("./prompt-broker.ts").PromptBroker
  /** Image-id allocation for `graphics.write` (absent in older test doubles). */
  readonly graphics?: import("./graphics-ids.ts").GraphicsImageIds
  /** Pending exact Terminal Tab closes awaiting a TUI acknowledgement. */
  readonly tabCloses?: TabCloseBroker
  /** Plugin sink for agent-lifecycle events — a direct feed, deliberately NOT a bus channel. */
  readonly plugins?: Pick<import("../plugins/runtime.ts").PluginHost, "handleEngineReport" | "handleUiReport">
  /** Daemon-process facts + lifecycle controls handlers surface or drive. */
  readonly daemon: {
    readonly startedAt: Date
    readonly socketPath: string
    /** State root served (`<homeDir>/.kobe`). `hello` reports it so a client
     *  detects a daemon from a DIFFERENT home on its socket, whose empty task
     *  index would otherwise render as "you have no tasks". */
    readonly homeDir?: string
    /** Reported by `hello` / `daemon.status`. */
    readonly pid: number
    /** Attached-GUI refcount (reported as `attachedClients`). */
    guiCount(): number
    /** Cell pixel size per attached GUI that measured its tty. A GUI whose
     *  terminal declines `CSI 16 t` is absent — no placeholder, a guessed cell
     *  size places every picture wrong. Absent in older test doubles. */
    guiCellSizes?(): readonly import("./channels-events.ts").CellPixelSize[]
    /** Every attached client, GUI or pane. `session.deliver` runs in whichever
     *  client hosts the session, so this (not the GUI refcount) says a
     *  dispatch could reach anyone. */
    clientCount(): number
    /** Would any subscriber RECEIVE a publish on this channel? Lets a handler
     *  skip building an unheard payload. `undefined` → publish anyway. */
    hasSubscribersFor?(channel: ChannelName): boolean
    /** Graceful self-stop; the reason rides the `daemon.stopping` broadcast ({@link DaemonStopReason}). */
    stopSoon(reason?: DaemonStopReason): Promise<void>
    /** Re-check idle shutdown after a keep-alive hold may be gone (last automation disabled, no gui). */
    reevaluateIdle(): void
  }
  /** The requesting connection's id (`hello` echoes it back as `clientId`). */
  readonly clientId: number
}

/**
 * One RPC. Throwing is the error path (shaped by {@link shapeDaemonError});
 * the return value is the response `payload`, byte-for-byte.
 */
export interface DaemonRequestHandler {
  readonly name: DaemonRequestName
  /**
   * May this verb outlive the client's 20s wedge deadline? The socket client
   * can't import this registry (it would pull every daemon module into the
   * CLI), so it reads a mirror in `protocol.ts`; rpc-deadline.test.ts fails
   * when they drift.
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
 * The ONE place a thrown error becomes a wire {@link DaemonError}. `Error`s
 * carry `message` + `name` (plain `Error` → `name: "Error"`); anything else is
 * `String(…)`-coerced and `name` is `undefined`, so the key never hits the wire.
 *
 * NOT used by `server.ts`'s parse-error path, which sends a bare `{ message }`
 * — shaping it here would add `"name":"SyntaxError"` bytes to the wire.
 */
export function shapeDaemonError(err: unknown): DaemonError {
  return {
    message: err instanceof Error ? err.message : String(err),
    name: err instanceof Error ? err.name : undefined,
  }
}

/** Run the handler for `name`. Unknown names (a v2 client's removed `daemon.web.*`, future verbs) must get exactly `unknown daemon request: …`. */
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

/** Handlers are stateless, so one map is shared across every connection. */
export function createDaemonHandlerRegistry(): ReadonlyMap<DaemonRequestName, DaemonRequestHandler> {
  const entries: DaemonRequestHandler[] = [
    {
      name: "hello",
      handle(payload, ctx) {
        // Negotiate a RANGE (isProtocolCompatible). Missing version = current;
        // missing min = its version. Only a true range mismatch is rejected.
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
          // BUILD version (package.json): catches a stale-build daemon after a
          // patch upgrade (same protocol) → non-fatal "restart the daemon" banner.
          kobeVersion: ctx.runtime.currentVersion,
          capabilities: [...CHANNEL_NAMES],
          daemonPid: ctx.daemon.pid,
          clientId: ctx.clientId,
          // A client whose home differs must reject `tasks` rather than render
          // an empty sidebar (protocol.isForeignDaemonHome).
          homeDir: ctx.daemon.homeDir,
          // Over an SSH tunnel only this says WHICH machine answered; with
          // `homeDir` + `daemonPid` it dedupes machine aliases (duplicateAliasOf).
          hostname: hostname(),
          tasks: ctx.orch.listTasks().map(serializeTask),
        }
      },
    },
    {
      name: "daemon.status",
      handle(_payload, ctx) {
        return {
          daemonPid: ctx.daemon.pid,
          // Makes a stale-build daemon visible in `daemon status` / doctor without a TUI.
          kobeVersion: ctx.runtime.currentVersion,
          uptimeMs: Date.now() - ctx.daemon.startedAt.getTime(),
          startedAt: ctx.daemon.startedAt.toISOString(),
          // GUI refcount that keeps the daemon alive; excludes panes and CLI pokes.
          attachedClients: ctx.daemon.guiCount(),
          // Why a daemon with zero clients is up; otherwise a schedule looks like a leak.
          automationHold: ctx.automations.hasEnabled(),
          taskCount: ctx.orch.listTasks().length,
          // Lets `rove doctor` name a daemon from a DIFFERENT home squatting the
          // socket, which otherwise reads as "my tasks vanished".
          homeDir: ctx.daemon.homeDir,
          socketPath: ctx.daemon.socketPath,
          // `rove machine add` reads these over SSH instead of guessing: the
          // remote home may be another user, and `fitSocketPath` may shorten
          // either path for sun_path, so neither is derivable locally.
          ptySocketPath: defaultPtyHostSocketPath(ctx.daemon.homeDir),
          hostname: hostname(),
        }
      },
    },
    {
      name: "daemon.stop",
      async handle(payload, ctx) {
        // Only `restart` may be claimed (by `daemon restart` / TUI refresh): it
        // tells clients the code is being swapped. Anything else, unset or
        // unknown, is `stop`, so no caller can dress a shutdown as an upgrade.
        const reason = parseDaemonStopReason(payload.reason) === "restart" ? "restart" : "stop"
        await ctx.daemon.stopSoon(reason)
        return {}
      },
    },
    // Entry ORDER is not wire-load-bearing (only key order within a payload is).
    ...TASK_HANDLERS,
    ...WORKTREE_HANDLERS,
    ...ATTENTION_HANDLERS,
    ...AUTOMATION_HANDLERS,
    ...WORK_ITEM_HANDLERS,
    ...AGENT_TURN_HANDLERS,
    ...UI_HANDLERS,
    ...GRAPHICS_HANDLERS,
    ...ISSUE_HANDLERS,
    ...PR_HANDLERS,
    {
      // `kobe api inspect`: raw transient state, read-only. Wire payloads hide
      // the fields (probe vendor, armed watchdogs) badge/idle bugs hinge on.
      name: "debug.inspect",
      handle(_payload, ctx) {
        return {
          daemonPid: ctx.daemon.pid,
          kobeVersion: ctx.runtime.currentVersion,
          startedAt: ctx.daemon.startedAt.toISOString(),
          activity: ctx.activity.debugSnapshot(),
          attachedClients: ctx.daemon.guiCount(),
          // GUI + pane connections. `session.deliver` is only PERFORMED by an
          // attached client, so 0 proves an `ok: true` dispatch reached nobody.
          // Non-zero proves nothing: the calling CLI counts.
          connectedClients: ctx.daemon.clientCount(),
          // Context reading per engine session (`taskId::tabId`) — the bus's
          // replayed last value; the only read that shows token counts.
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

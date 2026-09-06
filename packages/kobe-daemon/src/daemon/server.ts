/**
 * kobe daemon server: the single writer for the task index, plus the
 * push-channel bus every attached TUI/pane client subscribes to. RPC
 * surface: hello / daemon.status / daemon.stop + handlers.ts + subscribe.
 */

import { mkdir, unlink, writeFile } from "node:fs/promises"
import { type Server, createServer } from "node:net"
import { dirname } from "node:path"
import { ptyHostHasLiveSessions, sweepPtyHostSessions } from "../client/pty-process.ts"
import { tightenInstalledPluginPermissions } from "../plugins/permissions.ts"
import { maybeStartPluginHost } from "../plugins/runtime.ts"
import { type ClientState, broadcast, handleClientLine, writeFrame } from "./client-connection.ts"
import { ClientWriter } from "./client-writer.ts"
import { startDaemonCollectors } from "./collectors.ts"
import { linkLegacyRuntimePath } from "./compat-link.ts"
import type { DaemonOrchestrator } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { createDirectLink } from "./direct-link.ts"
import { DaemonEventBus } from "./event-bus.ts"
import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
  objectPayload,
  shapeDaemonError,
} from "./handlers.ts"
import { acquireHomeClaim } from "./home-owner.ts"
import { IssuesStore, defaultIssuesStorePath } from "./issues-store.ts"
import { DaemonLifetime, FIRST_GUI_GRACE_MS, resolveIdleGraceMs } from "./lifetime.ts"
import { LineReceiver } from "./line-receiver.ts"
import { NotesStore, defaultNotesStorePath } from "./notes-store.ts"
import { ensureOwnerOnlyStateDir } from "./owner-only.ts"
import {
  defaultDaemonPidPath,
  defaultDaemonSocketPath,
  legacyDaemonPidPath,
  legacyDaemonSocketPath,
  resolveDaemonHomeDir,
} from "./paths.ts"
import { PromptBroker } from "./prompt-broker.ts"
import {
  type DaemonFrame,
  type DaemonStopReason,
  type DaemonStoppingPayload,
  normalizeChannelFilter,
  serializeTask,
} from "./protocol.ts"
import { startPtyExitWatch } from "./pty-exit-watch.ts"
import { PtyLiveHold } from "./pty-live-hold.ts"
import type { DaemonServer, DaemonServerOptions } from "./server-options.ts"
import { DaemonResources } from "./server-resources.ts"
import { createSocketOwnershipGuard, listenOnUnixSocket } from "./socket-guard.ts"
import { initDaemonStores } from "./stores.ts"
import { handleSubscribe } from "./subscribe.ts"
import { TabCloseBroker } from "./tab-close-broker.ts"
import { WorkItemCache } from "./work-items.ts"

// RPC handler registry + per-request dispatch seam — re-exported so consumers
// (tests) keep the existing `daemon/server` import path.
export {
  blockingRpcNames,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
  shapeDaemonError,
  type DaemonHandlerContext,
  type DaemonRequestHandler,
} from "./handlers.ts"
export { readPidFile } from "./socket-guard.ts"
export { IssuesStore, defaultIssuesStorePath } from "./issues-store.ts"
export { NotesStore, defaultNotesStorePath } from "./notes-store.ts"
export type { DaemonClientConnection } from "./client-connection.ts"
export type { DaemonServer, DaemonServerOptions } from "./server-options.ts"

export async function startDaemonServer(
  createOrchestrator: () => DaemonOrchestrator | Promise<DaemonOrchestrator>,
  options: DaemonServerOptions,
): Promise<DaemonServer> {
  const homeDir = resolveDaemonHomeDir(options.homeDir)
  const socketPath = options.socketPath ?? defaultDaemonSocketPath(options.homeDir)
  const lease = await acquireHomeClaim({ homeDir, socketPath })
  const resources = new DaemonResources()
  resources.defer(() => lease.release())
  resources.defer(() => options.onStop?.())
  try {
    const orch = await createOrchestrator()
    return await startOwnedServer(orch, options, resources)
  } catch (err) {
    await resources.close()
    throw err
  }
}

async function startOwnedServer(
  orch: DaemonOrchestrator,
  options: DaemonServerOptions,
  resources: DaemonResources,
): Promise<DaemonServer> {
  const runtime = options.runtime
  const socketPath = options.socketPath ?? defaultDaemonSocketPath(options.homeDir)
  const pidPath = options.pidPath ?? defaultDaemonPidPath(options.homeDir)
  const homeDir = resolveDaemonHomeDir(options.homeDir)
  const startedAt = options.startedAt ?? new Date()
  const clients = new Set<ClientState>()
  let nextClientId = 1
  /** Why this daemon is going away — read once by the `daemon.stopping`
   *  broadcast in the teardown deferral below. Every path into `stopSoon`
   *  names its own reason; `stop` is the honest default for a shutdown
   *  nobody labelled (an outright `close()`, a signal). */
  let stopReason: DaemonStopReason = "stop"
  const requests = new Set<Promise<void>>()

  // Refcounted lazy shutdown + collector gate (KOB): the daemon's lifetime is
  // bound to the number of attached GUIs — a front-end that subscribed with
  // `role: "gui"` (the `rove` TUI process). The count
  // deliberately EXCLUDES helper panes (Tasks/Ops/settings, `role: "pane"`):
  // those subscribe for push channels but persist after the user quits the
  // front-end, so counting them kept the daemon alive forever (N Terminal Tabs
  // = N Tasks panes, count never hit 0 on quit). CLI pokes (hello-only status/
  // stop, `daemon restart`) never subscribe at all. When the LAST gui
  // disconnects we wait a short grace then self-stop, via the normal
  // `stopSoon()` path which NEVER touches task sessions (they outlive the
  // daemon; only `kobe reset` / `kobe kill-sessions` tear them down). The same
  // object also gates the background collectors on `hasSubscribers()`. The
  // whole policy — refcount, grace timer, stopping flag — lives in
  // DaemonLifetime (lifetime.ts), unit-tested in isolation; the live `clients`
  // set stays its source of truth, so there's no counter to drift.
  const lifetime = new DaemonLifetime({
    clients: function* () {
      yield* clients
    },
    idleGraceMs: resolveIdleGraceMs(),
    // Autospawned daemons (connectOrStartDaemon's spawn stamps the env
    // flag) reap themselves if no gui EVER attaches — the zombie hole.
    ...(process.env.KOBE_DAEMON_AUTOSPAWNED === "1" ? { firstGuiGraceMs: FIRST_GUI_GRACE_MS } : {}),
    // Non-gui reasons to stay alive, both read lazily (constructed below,
    // polled at shutdown-decision time): an enabled schedule — one that only
    // fires while someone is watching is not a schedule — and a live hosted
    // PTY session (see pty-live-hold.ts: idle-stopping while engines run
    // drops their hook events and blanks the activity dots).
    keepAlive: () => automations.hasEnabled() || ptyHold.isHeld(),
    onIdleStop: () => void stopSoon("idle").catch((err) => logDaemonError("daemon-idle-shutdown", err)),
  })
  const ptyHold = new PtyLiveHold({
    probe: () => ptyHostHasLiveSessions(options.homeDir),
    onRelease: () => lifetime.reevaluateIdle(),
  })
  resources.defer(() => lifetime.markStopping())
  resources.defer(() => ptyHold.stop())

  // Channel event bus: the single hub the daemon publishes push
  // events to. One sink fans each publish out to subscribed sockets; the
  // bus also caches the last value per channel so a late subscriber gets
  // the current value on connect. `task.snapshot` is channel #1; new
  // channels just call `bus.publish` (see protocol.ts ChannelPayloads).
  const bus = new DaemonEventBus()
  bus.onPublish((event) => {
    broadcast(clients, { type: "event", name: event.channel, payload: event.payload })
  })

  // Daemon-owned durable stores + the per-task teardown runner — CREATED in
  // stores.ts, wired together here; see initDaemonStores.
  const {
    activity,
    inbox,
    agentTurns,
    deletions,
    issues,
    notes,
    deferredPrompts,
    automations,
    workItems,
    quotaUsage,
    engineEvents,
  } = await initDaemonStores(orch, runtime, bus, options.homeDir)
  resources.defer(() => activity.close())
  resources.defer(() => deletions.drain())
  resources.defer(async () => {
    await Promise.allSettled(requests)
  })

  // 0700 on creation AND on every boot: the socket below has no peer-
  // credential check, so this directory's mode is the entire ACL, and an
  // install that predates the mode argument is exactly the one that is
  // exposed (see owner-only.ts).
  await ensureOwnerOnlyStateDir(homeDir)
  await mkdir(dirname(socketPath), { recursive: true })
  await mkdir(dirname(pidPath), { recursive: true })
  // Same repair for the plugin tree, whose `.env` is where PLUGIN-AUTHORING
  // tells authors to keep API keys.
  tightenInstalledPluginPermissions(options.homeDir)
  // Stale leftover only — a live owner was refused at the top of this boot.
  await unlink(socketPath).catch(() => {})

  const server: Server = createServer((socket) => {
    const client: ClientState = {
      id: nextClientId++,
      connectedAt: new Date(),
      socket,
      writer: new ClientWriter(socket, {
        onOverflow: () => {
          logDaemonInfo("backpressure", "disconnecting daemon client whose queue exceeded 8MiB")
          socket.destroy()
        },
      }),
      subscribed: false,
      holdsLifetime: false,
      channels: null,
    }
    clients.add(client)

    const receiver = new LineReceiver()
    socket.on("data", (chunk: Buffer) => {
      if (
        !receiver.push(chunk, (line) =>
          handleClientLine(client, line, (req, c) => {
            if (lifetime.isStopping()) return
            const pending = handleRequest(req, c).finally(() => requests.delete(pending))
            requests.add(pending)
          }),
        )
      ) {
        logDaemonInfo("framing", "disconnecting daemon client whose request exceeded 8MiB")
        socket.destroy()
      }
    })
    socket.on("error", () => {})
    socket.on("close", () => {
      clients.delete(client)
      if (client.subscribed) {
        logDaemonInfo(
          "conn",
          `client #${client.id} (${client.holdsLifetime ? "gui" : "pane"}) disconnected — ${clients.size} client(s), ${lifetime.guiCount()} gui left`,
        )
      }
      // Last GUI gone → start the grace timer toward self-stop. Only a
      // `holdsLifetime` (role "gui") client arms it: a helper pane or a
      // transient CLI poke leaves the gui count unchanged, so neither trips
      // shutdown when it disconnects. Refresh the pty hold first so the
      // grace recheck reads live-session truth, not a poll-stale cache.
      if (client.holdsLifetime) {
        void ptyHold.probeSoon().then(() => lifetime.clientDisconnected(true))
      }
    })
  })

  let sweep: Promise<void> | undefined
  let sweepNeeded = false
  const scheduleSweep = (): void => {
    sweepNeeded = true
    sweep ??= (async () => {
      while (sweepNeeded && !lifetime.isStopping()) {
        sweepNeeded = false
        await sweepPtyHostSessions(
          () => (lifetime.isStopping() ? null : orch.listTasks().map((task) => task.id)),
          options.homeDir,
        )
      }
    })().finally(() => {
      sweep = undefined
      if (sweepNeeded && !lifetime.isStopping()) scheduleSweep()
    })
  }
  resources.defer(async () => {
    await sweep
  })
  const unsubscribeStore = orch.subscribeTasks((snapshot) => {
    bus.publish("task.snapshot", { tasks: snapshot.map(serializeTask) })
    scheduleSweep()
  })
  resources.defer(unsubscribeStore)
  deletions.resume(orch.listTasks())

  // Warm the active-task channel with the orchestrator's restored focus
  // (seeded from the persisted `lastActive` record — state/last-active.ts).
  // Without this the channel stays cold until the first `task.setActive`,
  // so every client connecting to a FRESH daemon replays tasks but no
  // focus and falls back to "first task in the list" instead of the last
  // focused one. Publishing null is deliberate — a populated channel with
  // an explicit "no focus" beats a cold one. Optional-chained because test
  // doubles stub a partial Orchestrator.
  bus.publish("active-task", { taskId: orch.activeTaskSignal?.()?.() ?? null })

  // Background collectors/watchers (update poll, auto-title, ui-prefs /
  // keybindings watchers, worktree-changes / transcript-activity / pr-status)
  // — wired in collectors.ts; per-tick work is gated on attached subscribers
  // so a gui-less daemon never polls npm / git / gh for nobody.
  const stopCollectors = startDaemonCollectors(
    orch,
    runtime,
    bus,
    (channel) => lifetime.hasSubscribersFor(channel),
    options,
    quotaUsage,
    {
      store: automations,
      // `selfLink` is defined below (it closes over handlerContext, which closes
      // over half this function); the sweep only reads it on a tick, long after
      // construction settles.
      link: () => selfLink,
      // Same construction-order deferral: the plugin host starts right after
      // the collectors, and the sweep only reads it on a tick.
      plugins: () => pluginHost,
      // A standing routine session whose composer is busy hands its report to
      // these instead of dropping it.
      ...(deferredPrompts ? { deferred: deferredPrompts } : {}),
      inbox,
    },
    activity,
    deferredPrompts ? { store: deferredPrompts, inbox } : undefined,
  )

  resources.defer(stopCollectors)

  // Plugin runtime: startup hooks + channel-derived event hooks (plugins/runtime.ts).
  const pluginHost = maybeStartPluginHost(bus, options, socketPath, (line) => logDaemonInfo("plugin-host", line))
  resources.defer(() => pluginHost?.stop())
  // session.exited plugin events off the pty-host's death records (the host
  // is a separate process; the file is the channel — see pty-exit-watch.ts).
  const stopPtyExitWatch = pluginHost
    ? startPtyExitWatch({
        ...(options.homeDir ? { homeDir: options.homeDir } : {}),
        plugins: () => pluginHost,
        // The halves that reach the UI: a death becomes the tab's `dead`
        // activity badge AND a durable Inbox episode — not just a plugin
        // event with no subscribers.
        activity,
        inbox,
        log: (line) => logDaemonInfo("plugin-host", line),
      })
    : () => {}

  resources.defer(stopPtyExitWatch)

  // Pending host-dialog prompts (`ui.prompt` ↔ `ui.promptReply`).
  const prompts = new PromptBroker()
  const tabCloses = new TabCloseBroker()
  resources.defer(() => {
    prompts.clear()
    tabCloses.clear()
  })

  // Ownership watch (rationale in socket-guard.ts): a daemon whose
  // socket path was taken over is unreachable for every NEW connection and
  // must not linger as a split-brain island — stop, so the attached clients'
  // reconnect loops migrate them to the new owner.
  const sockGuard = createSocketOwnershipGuard({
    socketPath,
    pidPath,
    ...(options.socketWatchMs !== undefined ? { watchMs: options.socketWatchMs } : {}),
    onLost: () => {
      logDaemonInfo("sock", "socket path was taken over or removed — stopping so clients reconnect to the new owner")
      void stopSoon("socket-lost").catch((err) => logDaemonError("daemon-socket-lost-shutdown", err))
    },
  })
  const serverApi: DaemonServer = {
    socketPath,
    pidPath,
    startedAt,
    clients,
    close() {
      lifetime.markStopping()
      return resources.close()
    },
  }
  resources.defer(async () => {
    // WHY, not just THAT (v5). Every shutdown looks the same from a client
    // socket, and one of them is different in kind: a `restart` means an
    // operator is swapping this daemon's code, so an attached TUI is about to
    // be a build behind and can offer to refresh itself the instant the frame
    // lands — instead of waiting out a reconnect plus a `hello` under backoff.
    // The version rides along for the same reason: it is the comparison the
    // client would otherwise have to reconnect to make.
    const payload: DaemonStoppingPayload = { reason: stopReason, kobeVersion: runtime.currentVersion }
    broadcast(clients, { type: "event", name: "daemon.stopping", payload })
    for (const client of clients) client.socket.destroy()
    await sockGuard.release(server)
  })

  // RPC dispatch seam: every plain request is a registry entry
  // (handlers.ts) — look up → validate → handle — with all daemon state
  // arriving via the per-request context built below. ONE request stays
  // outside the registry: `subscribe` is connection lifecycle, not RPC. It
  // mutates per-socket state (`subscribed`, `holdsLifetime`), drives the
  // gui-refcount idle-grace timer, and writes event frames directly to the
  // socket (channel replay) — none of which the registry's payload→result
  // shape can express — so it lives here next to the machinery it touches.
  const handlers = createDaemonHandlerRegistry()

  function handlerContext(clientId: number): DaemonHandlerContext {
    return {
      orch,
      runtime,
      bus,
      activity,
      inbox,
      agentTurns,
      deletions,
      issues,
      notes,
      deferredPrompts,
      automations,
      workItems,
      selfLink,
      quotaUsage,
      engineEvents,
      ...(pluginHost ? { plugins: pluginHost } : {}),
      prompts,
      tabCloses,
      daemon: {
        startedAt,
        socketPath,
        homeDir,
        pid: process.pid,
        guiCount: () => lifetime.guiCount(),
        clientCount: () => clients.size,
        stopSoon,
        reevaluateIdle: () => lifetime.reevaluateIdle(),
      },
      clientId,
    }
  }

  // In-process RPC client over the daemon's OWN handler registry — no socket
  // round-trip. Built unconditionally: the automation runner needs it to launch
  // engine sessions whether or not anyone is attached.
  const selfLink = createDirectLink({ ctx: handlerContext })

  // BIND LAST. The `createServer` callback above starts dispatching frames the
  // instant this resolves, and `dispatch` reads `handlers`/`selfLink` — `const`
  // bindings, so reaching them early is a ReferenceError, not `undefined`. With
  // the registry built after the bind, a client that connected during the four
  // awaits below got `Cannot access 'handlers' before initialization` back as
  // its hello response and the TUI exited 1; the window widened with machine
  // load, which is why it looked like a random 1-in-5 startup flake. Nothing
  // between here and the end of this function may be needed to answer a
  // request.
  await listenOnUnixSocket(server, socketPath)
  // Fingerprint FIRST, before any other await. Every await between bind and
  // arm is a window in which a usurper can unlink+rebind the path; arming
  // late meant either no stamp at all or a stamp of the usurper's inode.
  await sockGuard.arm()
  await writeFile(pidPath, `${process.pid}\n`, "utf8")
  // A pre-rename binary only knows `.kobe`; without these it starts a second
  // daemon on the same task index. See compat-link.ts.
  await linkLegacyRuntimePath(socketPath, legacyDaemonSocketPath(homeDir))
  await linkLegacyRuntimePath(pidPath, legacyDaemonPidPath(homeDir))

  async function stopSoon(reason: DaemonStopReason = "stop"): Promise<void> {
    if (lifetime.isStopping()) return
    stopReason = reason
    lifetime.markStopping()
    setTimeout(() => {
      serverApi.close().catch((err) => logDaemonError("daemon-shutdown", err))
    }, 0).unref()
  }

  async function dispatch(req: Extract<DaemonFrame, { type: "request" }>, client: ClientState): Promise<unknown> {
    if (req.name === "subscribe") {
      const hadSubscribers = lifetime.hasSubscribers()
      const result = handleSubscribe(client, objectPayload(req.payload), {
        bus,
        activity,
        lifetime,
        clientCount: () => clients.size,
        writeEvent: (target, name, payload) => writeFrame(target as ClientState, { type: "event", name, payload }),
      })
      if (!hadSubscribers && lifetime.hasSubscribers()) {
        // The poller's startup tick can land ahead of a client's subscribe;
        // wake it now instead of leaving a cold footer empty for 60 seconds.
        for (const vendor of runtime.vendorsWithQuotaProbe()) void quotaUsage.refreshIfDue(vendor)
      }
      return result
    }
    // `pty.*` requests are NOT served here — they belong to the standalone
    // pty host process's socket (`pty-server.ts`). A client that sends one
    // to the daemon gets the registry's "unknown daemon request" error.
    return dispatchDaemonRequest(handlers, req.name, req.payload, handlerContext(client.id))
  }

  async function handleRequest(req: Extract<DaemonFrame, { type: "request" }>, client: ClientState): Promise<void> {
    try {
      const payload = await dispatch(req, client)
      writeFrame(client, { type: "response", id: req.id, name: req.name, payload })
    } catch (err) {
      // shapeDaemonError (handlers.ts) is the ONE place a thrown error
      // becomes a wire DaemonError — message + Error name. The parse-error
      // path below deliberately stays bare `{ message }`: a `name` has never
      // been part of that frame's wire shape.
      writeFrame(client, { type: "response", id: req.id, name: req.name, error: shapeDaemonError(err) })
    }
  }

  ptyHold.start()
  return serverApi
}

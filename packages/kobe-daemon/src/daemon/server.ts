/**
 * kobe daemon server: the single writer for the task index, plus the
 * push-channel bus every attached TUI/pane client subscribes to. RPC
 * surface: hello / daemon.status / daemon.stop + handlers.ts + subscribe.
 */

import { mkdir, unlink } from "node:fs/promises"
import { type Server, createServer } from "node:net"
import { dirname } from "node:path"
import { ptyHostHasLiveSessions, sweepPtyHostSessions } from "../client/pty-process.ts"
import { tightenInstalledPluginPermissions } from "../plugins/permissions.ts"
import { maybeStartPluginHost } from "../plugins/runtime.ts"
import type { CellPixelSize } from "./channels-events.ts"
import { type ClientState, broadcast, handleClientLine, writeFrame } from "./client-connection.ts"
import { ClientWriter } from "./client-writer.ts"
import { startDaemonCollectors } from "./collectors.ts"
import { linkLegacyRuntimePath } from "./compat-link.ts"
import type { DaemonOrchestrator } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { createDirectLink } from "./direct-link.ts"
import { DaemonEventBus } from "./event-bus.ts"
import { GraphicsImageIds } from "./graphics-ids.ts"
import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
  objectPayload,
  shapeDaemonError,
} from "./handlers.ts"
import { acquireHomeClaim } from "./home-owner.ts"
import { writeTextAtomic } from "./json-file.ts"
import { DaemonLifetime, FIRST_GUI_GRACE_MS, resolveIdleGraceMs } from "./lifetime.ts"
import { LineReceiver } from "./line-receiver.ts"
import { ensureOwnerOnlyStateDir } from "./owner-only.ts"
import {
  defaultDaemonPidPath,
  defaultDaemonSocketPath,
  legacyDaemonPidPath,
  legacyDaemonSocketPath,
  resolveDaemonHomeDir,
} from "./paths.ts"
import { PromptBroker } from "./prompt-broker.ts"
import { type DaemonFrame, type DaemonStopReason, type DaemonStoppingPayload, serializeTask } from "./protocol.ts"
import { startPtyExitWatch } from "./pty-exit-watch.ts"
import { PtyLiveHold } from "./pty-live-hold.ts"
import type { DaemonServer, DaemonServerOptions } from "./server-options.ts"
import { DaemonResources } from "./server-resources.ts"
import { createSocketOwnershipGuard, listenOnUnixSocket } from "./socket-guard.ts"
import { initDaemonStores } from "./stores.ts"
import { handleSubscribe } from "./subscribe.ts"
import { TabCloseBroker } from "./tab-close-broker.ts"

// Re-exported so tests keep the `daemon/server` import path.
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
  /** Reason for the `daemon.stopping` broadcast; `stop` is the default for an
   *  unlabelled shutdown (an outright `close()`, a signal). */
  let stopReason: DaemonStopReason = "stop"
  const requests = new Set<Promise<void>>()

  // Lifetime is refcounted on `role: "gui"` subscribers (the `rove` TUI).
  // Helper panes (`role: "pane"`) are EXCLUDED: they outlive the front-end,
  // so counting them kept the daemon alive forever. CLI pokes never
  // subscribe. After the last gui leaves, a short grace then `stopSoon()`,
  // which never touches task sessions (only `kobe reset` / `kobe
  // kill-sessions` do). Also gates collectors on `hasSubscribers()`. The
  // live `clients` set is the source of truth — no counter to drift.
  const lifetime = new DaemonLifetime({
    clients: function* () {
      yield* clients
    },
    idleGraceMs: resolveIdleGraceMs(),
    // Autospawned daemons reap themselves if no gui EVER attaches.
    ...(process.env.KOBE_DAEMON_AUTOSPAWNED === "1" ? { firstGuiGraceMs: FIRST_GUI_GRACE_MS } : {}),
    // Read lazily (both constructed below). An enabled schedule must fire
    // unwatched; idle-stopping under a live PTY drops engine hook events and
    // blanks the activity dots.
    keepAlive: () => automations.hasEnabled() || ptyHold.isHeld(),
    onIdleStop: () => void stopSoon("idle").catch((err) => logDaemonError("daemon-idle-shutdown", err)),
  })
  const ptyHold = new PtyLiveHold({
    probe: () => ptyHostHasLiveSessions(options.homeDir),
    onRelease: () => lifetime.reevaluateIdle(),
  })
  resources.defer(() => lifetime.markStopping())
  resources.defer(() => ptyHold.stop())

  // `graphics.write` image ids: in-memory is enough, since the terminal store
  // they name doesn't survive a daemon restart either.
  const graphics = new GraphicsImageIds()
  // Caches the last value per channel so a late subscriber gets it on connect.
  const bus = new DaemonEventBus()
  bus.onPublish((event) => {
    broadcast(clients, { type: "event", name: event.channel, payload: event.payload })
  })

  // Spread wholesale into the handler context: `DaemonStores` IS its store half.
  const stores = await initDaemonStores(orch, runtime, bus, options.homeDir)
  const { activity, deletions, rowTokens, automations, quotaUsage, inbox } = stores
  resources.defer(() => activity.close())
  resources.defer(() => rowTokens.close())
  resources.defer(() => deletions.drain())
  resources.defer(async () => {
    await Promise.allSettled(requests)
  })

  // 0700 on every boot, not just creation: the socket has no peer-credential
  // check, so this directory's mode is the entire ACL (see owner-only.ts).
  await ensureOwnerOnlyStateDir(homeDir)
  await mkdir(dirname(socketPath), { recursive: true })
  await mkdir(dirname(pidPath), { recursive: true })
  // Same for the plugin tree, whose `.env` holds plugin API keys.
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
      cellPixelSize: null,
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
      // Only a gui disconnect arms the idle grace. Refresh the pty hold first
      // so the grace recheck reads live truth, not a poll-stale cache.
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

  // Warm the active-task channel with the restored focus, else clients of a
  // fresh daemon fall back to the first task. Null is deliberate: explicit
  // "no focus" beats a cold channel. Optional-chained for partial test doubles.
  bus.publish("active-task", { taskId: orch.activeTaskSignal?.()?.() ?? null })

  // Per-tick work is gated on subscribers so a gui-less daemon never polls
  // npm / git / gh for nobody.
  const stopCollectors = startDaemonCollectors(
    orch,
    runtime,
    bus,
    (channel) => lifetime.hasSubscribersFor(channel),
    options,
    quotaUsage,
    {
      store: automations,
      // Deferred: `selfLink` and `pluginHost` are defined below; the sweep only
      // reads them on a tick, after construction settles.
      link: () => selfLink,
      plugins: () => pluginHost,
      inbox,
    },
    activity,
  )

  resources.defer(stopCollectors)

  const pluginHost = maybeStartPluginHost(bus, options, socketPath, (line) => logDaemonInfo("plugin-host", line))
  resources.defer(() => pluginHost?.stop())
  // session.exited events from the pty-host's death records file (separate process).
  const stopPtyExitWatch = pluginHost
    ? startPtyExitWatch({
        ...(options.homeDir ? { homeDir: options.homeDir } : {}),
        plugins: () => pluginHost,
        // A death also becomes the tab's `dead` badge and an Inbox episode.
        activity,
        inbox,
        log: (line) => logDaemonInfo("plugin-host", line),
      })
    : () => {}

  resources.defer(stopPtyExitWatch)

  const prompts = new PromptBroker()
  const tabCloses = new TabCloseBroker()
  resources.defer(() => {
    prompts.clear()
    tabCloses.clear()
  })

  // A daemon whose socket path was taken over is unreachable to new
  // connections: stop so clients reconnect to the new owner.
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
    // Carries the reason and version so a TUI can offer to refresh on a
    // `restart` immediately, instead of reconnecting to compare versions.
    const payload: DaemonStoppingPayload = { reason: stopReason, kobeVersion: runtime.currentVersion }
    broadcast(clients, { type: "event", name: "daemon.stopping", payload })
    for (const client of clients) client.socket.destroy()
    await sockGuard.release(server)
  })

  // Every request goes through the registry except `subscribe`: it mutates
  // per-socket state, drives the idle-grace timer, and writes event frames
  // directly — none of which the registry's payload→result shape expresses.
  const handlers = createDaemonHandlerRegistry()

  function handlerContext(clientId: number): DaemonHandlerContext {
    return {
      orch,
      runtime,
      bus,
      ...stores,
      selfLink,
      ...(pluginHost ? { plugins: pluginHost } : {}),
      prompts,
      tabCloses,
      graphics,
      daemon: {
        startedAt,
        socketPath,
        homeDir,
        pid: process.pid,
        guiCount: () => lifetime.guiCount(),
        guiCellSizes: () => {
          const sizes: CellPixelSize[] = []
          for (const c of clients) if (c.holdsLifetime && c.cellPixelSize) sizes.push(c.cellPixelSize)
          return sizes
        },
        clientCount: () => clients.size,
        hasSubscribersFor: (channel) => lifetime.hasSubscribersFor(channel),
        stopSoon,
        reevaluateIdle: () => lifetime.reevaluateIdle(),
      },
      clientId,
    }
  }

  // In-process RPC client; unconditional because automations launch engine
  // sessions whether or not anyone is attached.
  const selfLink = createDirectLink({ ctx: handlerContext })

  // BIND LAST: dispatch starts the instant this resolves and reads the
  // `handlers`/`selfLink` consts, so reaching them early is a ReferenceError
  // (the TUI exits 1 on hello, a load-dependent startup flake). Nothing below
  // may be needed to answer a request.
  await listenOnUnixSocket(server, socketPath)
  // Fingerprint before any other await: each await between bind and arm lets
  // a usurper unlink+rebind the path, and we'd stamp their inode.
  await sockGuard.arm()
  // tmp+rename: a torn pidfile is EMPTY, and empty parses as pid 0.
  await writeTextAtomic(pidPath, `${process.pid}\n`)
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
    // `pty.*` belongs to the pty host's socket (`pty-server.ts`); here it
    // gets "unknown daemon request".
    return dispatchDaemonRequest(handlers, req.name, req.payload, handlerContext(client.id))
  }

  async function handleRequest(req: Extract<DaemonFrame, { type: "request" }>, client: ClientState): Promise<void> {
    try {
      const payload = await dispatch(req, client)
      writeFrame(client, { type: "response", id: req.id, name: req.name, payload })
    } catch (err) {
      // The ONE place a thrown error becomes a wire DaemonError (message +
      // name). The parse-error path in client-connection.ts stays bare
      // `{ message }` — `name` was never part of that frame's wire shape.
      writeFrame(client, { type: "response", id: req.id, name: req.name, error: shapeDaemonError(err) })
    }
  }

  ptyHold.start()
  return serverApi
}

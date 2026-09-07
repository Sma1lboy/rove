/**
 * Daemon-side plugin host: loads the registry, runs `[[startup]]` hooks once
 * the socket is ready, and fires `[[events]]` hooks off the channel bus (via
 * PluginEventReducer). Every run is appended to the plugin's `log.jsonl`.
 *
 * Plugins are ordinary argv commands — no shell, cwd = plugin root, env
 * carries the ROVE_PLUGIN_* contract plus Kobe compatibility aliases. The host
 * stat-polls `plugins.json` AND each enabled plugin's `rove-plugin.toml`, so
 * both a CLI install/link/enable and an author's manifest edit apply to the
 * running daemon without a restart — polling, not `fs.watch`: on macOS the
 * FSEvents stream behind `fs.watch` starts asynchronously, and a write landing
 * before it is live is dropped forever, with no signal. Startup
 * hooks run only at daemon start (herdr semantics): a reload swaps hook
 * registrations, nothing more.
 *
 * Registry membership, not load success, drives `plugin.enabled` /
 * `plugin.disabled`: a manifest that stops parsing is a health problem, and
 * firing teardown on a TOML typo makes a plugin unregister its webhook because
 * the author fat-fingered a bracket.
 */

import { statSync } from "node:fs"
import type { ChannelEvent } from "../daemon/event-bus.ts"
import { type PluginEvent, PluginEventReducer, lifecycleEventFor } from "./events.ts"
import { type HookKillSet, type HookKind, runPluginHook } from "./hook-run.ts"
import {
  type PluginCommandSpec,
  type PluginEventName,
  type PluginManifest,
  currentPluginPlatform,
  pluginManifestPath,
  readPluginManifest,
  supportsPlatform,
} from "./manifest.ts"
import { pluginRegistryPath } from "./plugin-paths.ts"
import { loadPluginRegistry } from "./registry.ts"

export interface PluginHostOptions {
  readonly homeDir?: string
  readonly socketPath: string
  /** Path plugins should exec to call back into kobe (packaged `kobe` on PATH, or a dev override). */
  readonly binPath: string
  readonly log?: (line: string) => void
}

interface LoadedPlugin {
  readonly manifest: PluginManifest
  readonly root: string
}

const RELOAD_DEBOUNCE_MS = 150
/** Registry/manifest stat-poll cadence; reload latency is this + the debounce. */
const REGISTRY_POLL_MS = 200

/** mtime(ns) + size + inode of a file, or "absent" — the change detector for
 *  both the registry and the manifests. */
function fileStamp(path: string | null): string {
  if (!path) return "absent"
  try {
    const s = statSync(path, { bigint: true })
    return `${s.mtimeNs}:${s.size}:${s.ino}`
  } catch {
    return "absent"
  }
}

/** The bus surface a host needs: live fan-out plus the last-value cache. */
interface PluginHostBus {
  onPublish(sink: (event: ChannelEvent) => void): () => void
  snapshot(): ChannelEvent[]
}

/** Compose a host onto the daemon's bus: subscribe, seed, then start. */
export function startPluginHost(bus: PluginHostBus, opts: PluginHostOptions): PluginHost {
  const host = new PluginHost(opts)
  bus.onPublish((event) => host.handleChannel(event))
  // Seed the reducer from the bus's last-value cache. The daemon publishes
  // the baseline `task.snapshot` while wiring the orchestrator, well before
  // this host exists, so without the replay the first snapshot the reducer
  // sees is the first MUTATION — and its "first snapshot after daemon start
  // is baseline" rule swallows it, losing the first task.created /
  // worktree.created / task.changed of every daemon lifetime. The replay
  // itself emits nothing: it IS the reducer's baseline.
  for (const event of bus.snapshot()) host.handleChannel(event)
  host.start()
  return host
}

/** The server's one-liner: start a host iff `options.plugins` is set. */
export function maybeStartPluginHost(
  bus: PluginHostBus,
  options: { readonly homeDir?: string; readonly plugins?: { readonly binPath: string } },
  socketPath: string,
  log: (line: string) => void,
): PluginHost | null {
  if (!options.plugins) return null
  return startPluginHost(bus, { homeDir: options.homeDir, socketPath, binPath: options.plugins.binPath, log })
}

export class PluginHost {
  private readonly opts: PluginHostOptions
  private readonly reducer = new PluginEventReducer()
  private plugins: LoadedPlugin[] = []
  /** Ids the registry lists as enabled, whether or not their manifest parsed.
   *  This — not `plugins` — is what lifecycle events diff against. */
  private enabledIds = new Set<string>()
  /** Plugin root → stamp of its manifest at load, so an author's TOML edit
   *  triggers the same reload a registry write does. */
  private manifestStamps = new Map<string, string>()
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private registryStamp = ""
  private reloadTimer: ReturnType<typeof setTimeout> | undefined
  private readonly inFlight: HookKillSet = new Set()
  private stopped = false

  constructor(opts: PluginHostOptions) {
    this.opts = opts
  }

  /** Load the registry, run startup hooks, and begin watching for changes. */
  start(): void {
    // Watch BEFORE the first load: the baseline stamp is taken synchronously,
    // so a write landing before it is seen by the load below, and one landing
    // after it flips the stamp and triggers a reload. No write can fall
    // between the two.
    this.watchRegistry()
    this.plugins = this.loadPlugins()
    for (const plugin of this.plugins) {
      for (const [i, hook] of plugin.manifest.startup.entries()) {
        if (!supportsPlatform(hook, plugin.manifest, currentPluginPlatform())) continue
        void this.run(plugin, hook, "startup", { ROVE_PLUGIN_EVENT: "startup" }, `startup[${i}]`)
      }
    }
  }

  /**
   * Stop the host and run every `[[shutdown]]` hook. Resolves once each hook
   * has exited or been SIGKILLed at the grace deadline — the caller (daemon
   * close) MUST await it, or `process.exit` destroys the grace timers and the
   * hook children become unbounded orphans. Total wait is bounded by
   * {@link SHUTDOWN_GRACE_MS}; a host with no shutdown hooks resolves
   * immediately.
   */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    // Reap event/startup hooks that are still running FIRST. They hold this
    // process's stdout/stderr pipes, so leaving them to time out on their own
    // keeps the daemon alive past `rove daemon stop` — and a hook wedged on a
    // 30s deadline would make every stop take 30s.
    for (const kill of [...this.inFlight]) kill()
    const runs: Promise<void>[] = []
    for (const plugin of this.plugins) {
      for (const [i, hook] of plugin.manifest.shutdown.entries()) {
        if (!supportsPlatform(hook, plugin.manifest, currentPluginPlatform())) continue
        runs.push(this.run(plugin, hook, "shutdown", { ROVE_PLUGIN_EVENT: "shutdown" }, `shutdown[${i}]`))
      }
    }
    // allSettled, not all: `run` below makes the "never rejects" contract
    // true, but a short-circuit here would return while the OTHER plugins'
    // hooks are still running — unawaited, so the caller's `process.exit`
    // destroys their grace timers and leaves exactly the orphans the doc
    // comment above is about. One plugin must not cost the rest their reap.
    await Promise.allSettled(runs)
  }

  /** Feed every bus publish through here (server wires `bus.onPublish`). */
  handleChannel(event: ChannelEvent): void {
    if (this.stopped) return
    // Guarded: the bus sink loop and the orch.subscribeTasks callback have no
    // catch of their own, so a throw here (a pathological task field breaking
    // the diff's deep-compare) would kill the whole snapshot pipeline — the
    // PTY sweep included — on every subsequent publish. One bad diff must
    // cost one event batch, never the channel.
    try {
      for (const derived of this.reducer.reduce(event)) this.dispatch(derived)
    } catch (err) {
      this.opts.log?.(`plugin event reduce failed on ${event.channel} — ${String(err)}`)
    }
  }

  /** Direct feed from `ui.reportEvent` — TUI-originated product events
   *  (file/task/project opens). `kind` is already a plugin event name. */
  handleUiReport(report: {
    readonly kind: PluginEventName
    readonly taskId?: string
    readonly detail?: Record<string, unknown>
  }): void {
    if (this.stopped) return
    // Guarded here, once, so no reporting call site (RPC handlers, runners)
    // needs its own try/catch — a pathological detail payload breaking
    // JSON.stringify must never fail the operation that reported it.
    try {
      this.dispatch({
        event: report.kind,
        ...(report.taskId ? { taskId: report.taskId, task: this.reducer.contextFor(report.taskId) } : {}),
        ...(report.detail ? { detail: report.detail } : {}),
        at: Date.now(),
      })
    } catch (err) {
      this.opts.log?.(`plugin ui-report dispatch failed for ${report.kind} — ${String(err)}`)
    }
  }

  /**
   * Direct feed from `engine.reportEvent` (NOT a bus channel — lifecycle
   * kinds like tool.* would spam every attached client; plugins are the only
   * consumer, and dispatch already fans out only to hooks that declared the
   * event). One engine hook report → one plugin event.
   */
  handleEngineReport(report: {
    readonly kind: string
    readonly taskId: string
    readonly detail?: Record<string, unknown>
    readonly vendor?: string
    readonly tabId?: string
    readonly sessionId?: string
  }): void {
    if (this.stopped) return
    const event = lifecycleEventFor(report.kind, report.detail as { waiting?: string } | undefined)
    if (!event) return
    // Same single-site guard as handleUiReport.
    try {
      this.dispatch({
        event,
        taskId: report.taskId,
        task: this.reducer.contextFor(report.taskId),
        ...(report.vendor ? { vendor: report.vendor } : {}),
        ...(report.tabId ? { tabId: report.tabId } : {}),
        ...(report.sessionId ? { sessionId: report.sessionId } : {}),
        ...(report.detail ? { detail: report.detail } : {}),
        at: Date.now(),
      })
    } catch (err) {
      this.opts.log?.(`plugin engine-report dispatch failed for ${event} — ${String(err)}`)
    }
  }

  /** Fire one event at ONE plugin's matching hooks (registry transitions). */
  private dispatchTo(plugin: LoadedPlugin, event: PluginEvent): void {
    const platform = currentPluginPlatform()
    // One plugin's data must not cost another plugin its event — and this
    // path runs from the reload timer, where a throw is an uncaughtException
    // rather than a caught batch. Same reason as the entry-point guards.
    try {
      for (const hook of plugin.manifest.events) {
        if (hook.on !== event.event) continue
        if (!supportsPlatform(hook, plugin.manifest, platform)) continue
        void this.run(
          plugin,
          hook,
          "event",
          { ROVE_PLUGIN_EVENT: event.event, ROVE_PLUGIN_EVENT_JSON: JSON.stringify(event) },
          hook.on,
        )
      }
    } catch (err) {
      this.opts.log?.(`plugin ${plugin.manifest.id}: ${event.event} dispatch failed — ${String(err)}`)
    }
  }

  private dispatch(event: PluginEvent): void {
    const platform = currentPluginPlatform()
    for (const plugin of this.plugins) {
      // Per PLUGIN, not per batch: the callers' guards already keep a throw
      // off the channel, but they catch at the batch, so one plugin's data
      // would silently cost every plugin after it in this loop the event —
      // and, from `handleChannel`, the rest of the batch as well.
      try {
        for (const hook of plugin.manifest.events) {
          if (hook.on !== event.event) continue
          if (!supportsPlatform(hook, plugin.manifest, platform)) continue
          // Task id/title also ride as plain env vars so shell plugins don't
          // need a JSON parser for the common case.
          void this.run(
            plugin,
            hook,
            "event",
            {
              ROVE_PLUGIN_EVENT: event.event,
              ROVE_PLUGIN_EVENT_JSON: JSON.stringify(event),
              ...(event.taskId ? { ROVE_PLUGIN_TASK_ID: event.taskId } : {}),
              ...(event.task?.title ? { ROVE_PLUGIN_TASK_TITLE: event.task.title } : {}),
            },
            hook.on,
          )
        }
      } catch (err) {
        this.opts.log?.(`plugin ${plugin.manifest.id}: ${event.event} dispatch failed — ${String(err)}`)
      }
    }
  }

  private loadPlugins(): LoadedPlugin[] {
    const registry = loadPluginRegistry(this.opts.homeDir)
    const platform = currentPluginPlatform()
    const out: LoadedPlugin[] = []
    const enabled = new Set<string>()
    const stamps = new Map<string, string>()
    for (const entry of registry.plugins) {
      if (!entry.enabled) continue
      enabled.add(entry.id)
      // Stamped even when it fails to parse below: an author FIXING a typo
      // has to trigger the same reload as an author adding a hook.
      stamps.set(entry.root, fileStamp(pluginManifestPath(entry.root)))
      let manifest: PluginManifest
      try {
        manifest = readPluginManifest(entry.root).manifest
      } catch (err) {
        this.opts.log?.(`plugin ${entry.id}: manifest unreadable, skipping — ${String(err)}`)
        continue
      }
      if (!supportsPlatform({}, manifest, platform)) continue
      out.push({ manifest, root: entry.root })
    }
    this.enabledIds = enabled
    this.manifestStamps = stamps
    return out
  }

  /** True once any watched file changed. The registry stamp is consumed here
   *  (it is the authoritative one); manifest stamps are rebuilt by the reload
   *  itself, so a manifest still mid-write keeps re-arming the debounce. */
  private sourcesChanged(): boolean {
    const stamp = fileStamp(pluginRegistryPath(this.opts.homeDir))
    if (stamp !== this.registryStamp) {
      this.registryStamp = stamp
      return true
    }
    for (const [root, was] of this.manifestStamps) {
      if (fileStamp(pluginManifestPath(root)) !== was) return true
    }
    return false
  }

  private watchRegistry(): void {
    this.registryStamp = fileStamp(pluginRegistryPath(this.opts.homeDir))
    this.pollTimer = setInterval(() => {
      if (!this.sourcesChanged()) return
      // Debounce past the poll: a burst of CLI mutations (or a write still in
      // flight) collapses into one reload after the file settles.
      if (this.reloadTimer) clearTimeout(this.reloadTimer)
      this.reloadTimer = setTimeout(() => {
        if (this.stopped) return
        // The reload is the last dispatch path with no guard above it: it runs
        // from a timer, so a throw here is an uncaughtException in the daemon
        // rather than one lost event batch — and nothing restarts the poll
        // timer afterwards, so the host would stop seeing registry edits for
        // the rest of the daemon's life.
        try {
          const loadedBefore = new Map(this.plugins.map((p) => [p.manifest.id, p]))
          const enabledBefore = this.enabledIds
          this.plugins = this.loadPlugins()
          this.opts.log?.(`plugin registry reloaded (${this.plugins.length} enabled)`)
          // Registry transitions, delivered ONLY to the affected plugin, and
          // diffed against REGISTRY membership: a manifest that started or
          // stopped parsing has not been enabled or disabled by anyone, and
          // teardown must not fire on a syntax error.
          const at = Date.now()
          for (const plugin of this.plugins) {
            if (!enabledBefore.has(plugin.manifest.id)) {
              this.dispatchTo(plugin, { event: "plugin.enabled", detail: { pluginId: plugin.manifest.id }, at })
            }
          }
          for (const [id, plugin] of loadedBefore) {
            if (!this.enabledIds.has(id)) {
              this.dispatchTo(plugin, { event: "plugin.disabled", detail: { pluginId: id }, at })
            }
          }
        } catch (err) {
          this.opts.log?.(`plugin registry reload failed — ${String(err)}`)
        }
      }, RELOAD_DEBOUNCE_MS)
    }, REGISTRY_POLL_MS)
    this.pollTimer.unref?.()
  }

  /**
   * Fire one hook. Bounded and logged by `hook-run.ts`; never rejects — and
   * that is enforced HERE rather than assumed, because a manifest can still
   * make `spawn` throw synchronously: TOML accepts `\u0000`, so
   * `command = ["ec\u0000ho"]` parses fine and reaches `spawn` as argv with a
   * NUL byte, which throws `ERR_INVALID_ARG_VALUE` inside the hook's promise
   * executor. Every event/startup call site `void`s the result, so an
   * escaping rejection is an unhandledRejection in a long-lived daemon; only
   * `stop()` awaits, and there it would abandon the other plugins' hooks.
   */
  private run(
    plugin: LoadedPlugin,
    spec: PluginCommandSpec,
    kind: HookKind,
    extraEnv: Record<string, string>,
    label: string,
  ): Promise<void> {
    return runPluginHook({
      pluginId: plugin.manifest.id,
      pluginRoot: plugin.root,
      spec,
      kind,
      label,
      extraEnv,
      homeDir: this.opts.homeDir,
      socketPath: this.opts.socketPath,
      binPath: this.opts.binPath,
      log: this.opts.log,
      inFlight: this.inFlight,
    }).catch((err) => {
      this.opts.log?.(`plugin ${plugin.manifest.id} ${label}: ${String(err)}`)
    })
  }
}

/**
 * Daemon-side plugin host: loads the registry, runs `[[startup]]` hooks once
 * the socket is ready, and fires `[[events]]` hooks off the channel bus (via
 * PluginEventReducer). Every run is appended to the plugin's `log.jsonl`.
 *
 * Plugins are argv commands — no shell, cwd = plugin root, env carries the
 * ROVE_PLUGIN_* contract plus Kobe aliases. The host stat-polls
 * `plugins.json` and each enabled `rove-plugin.toml` so edits apply without
 * a restart. Polling, not `fs.watch`: macOS FSEvents starts asynchronously
 * and silently drops writes that land before it is live. A reload swaps hook
 * registrations only; startup hooks run once at daemon start.
 *
 * Registry membership, not load success, drives `plugin.enabled` /
 * `plugin.disabled`, so a TOML typo never fires teardown.
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

/** mtime(ns) + size + inode, or "absent" — the change detector. */
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
  // Seed the reducer's baseline from the last-value cache: the baseline
  // `task.snapshot` was published before this host existed, so otherwise the
  // first MUTATION becomes the baseline and its events are lost. The replay
  // emits nothing.
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
  /** Plugin root → manifest stamp at load, so a TOML edit triggers a reload. */
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
    // Stamp BEFORE the first load so no write can fall between the two.
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
   * Stop the host and run every `[[shutdown]]` hook; resolves once each has
   * exited or been SIGKILLed. The caller MUST await it, or `process.exit`
   * destroys the grace timers and orphans the hooks. Bounded by
   * {@link SHUTDOWN_GRACE_MS}.
   */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    // Reap running hooks FIRST: they hold our stdout/stderr pipes, so a hook
    // wedged on its 30s deadline would make every stop take 30s.
    for (const kill of [...this.inFlight]) kill()
    const runs: Promise<void>[] = []
    for (const plugin of this.plugins) {
      for (const [i, hook] of plugin.manifest.shutdown.entries()) {
        if (!supportsPlatform(hook, plugin.manifest, currentPluginPlatform())) continue
        runs.push(this.run(plugin, hook, "shutdown", { ROVE_PLUGIN_EVENT: "shutdown" }, `shutdown[${i}]`))
      }
    }
    // allSettled: a short-circuit would leave other plugins' hooks unawaited,
    // orphaned by the caller's `process.exit`.
    await Promise.allSettled(runs)
  }

  /** Feed every bus publish through here (server wires `bus.onPublish`). */
  handleChannel(event: ChannelEvent): void {
    if (this.stopped) return
    // The bus sink and subscribeTasks callback have no catch, so a throw here
    // would kill the snapshot pipeline (PTY sweep included). One bad diff
    // costs one batch, never the channel.
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
    // Guarded once here: a detail payload breaking JSON.stringify must never
    // fail the operation that reported it.
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
   * Direct feed from `engine.reportEvent` — not a bus channel, since tool.*
   * kinds would spam every client and plugins are the only consumer.
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
    // Per plugin, so one plugin's data can't cost another its event; also runs
    // from the reload timer, where a throw is an uncaughtException.
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
      // Per plugin: the callers catch per batch, so one plugin's throw would
      // cost every later plugin the event.
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
      // Stamped even if unparseable, so fixing a typo triggers a reload.
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

  /** Consumes the registry stamp; manifest stamps are rebuilt by the reload,
   *  so a manifest mid-write keeps re-arming the debounce. */
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
      // A burst of writes collapses into one reload after the file settles.
      if (this.reloadTimer) clearTimeout(this.reloadTimer)
      this.reloadTimer = setTimeout(() => {
        if (this.stopped) return
        // The last dispatch path with no guard above it: a throw from this
        // timer is an uncaughtException in the daemon, not one lost batch.
        try {
          const loadedBefore = new Map(this.plugins.map((p) => [p.manifest.id, p]))
          const enabledBefore = this.enabledIds
          this.plugins = this.loadPlugins()
          this.opts.log?.(`plugin registry reloaded (${this.plugins.length} enabled)`)
          // Delivered only to the affected plugin, diffed against registry
          // membership so a syntax error never fires teardown.
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
   * Fire one hook; never rejects, enforced here: TOML accepts `\u0000`, so a
   * NUL in argv makes `spawn` throw `ERR_INVALID_ARG_VALUE`, and every
   * event/startup call site `void`s the result.
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

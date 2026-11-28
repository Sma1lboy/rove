/**
 * Live incremental transcript stream for `TranscriptView` (`transcript.subscribe` /
 * `transcript.unsubscribe` → `transcript.update` pushes).
 *
 * Combines two triggers for every subscribed `(taskId, tab)`:
 *   1. Daemon hook & lifecycle events (`engine-state`, `engine.lifecycle`) via `poke(taskId)`.
 *   2. Direct transcript file watching (`startFileWatchTrigger`) for local tasks with a
 *      resolvable transcript path, started on first subscriber and torn down on last unsubscribe.
 *
 * Each subscriber tracks its own forward cursor so `read-output` fetches only newly appended
 * messages; `SOURCE_CHANGED` transparently re-reads a fresh page (`reset: true`) and re-resolves
 * the watched transcript file.
 */

import { protocolEntry, sessionProtocol } from "@sma1lboy/rove-core/engine/engine-presets.ts"
import { supportsStructuredHistory } from "@sma1lboy/rove-core/engine/registry.ts"
import { readTabsSnapshot } from "@sma1lboy/rove-core/tabs/tab-snapshot.ts"
import type { VendorId } from "@sma1lboy/rove-core/types/vendor.ts"
import { canonicalEngineTab } from "@sma1lboy/rove-daemon/daemon/engine-tabs"
import { startFileWatchTrigger } from "@sma1lboy/rove-daemon/daemon/file-watch-trigger"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { flag } from "./ops/args.ts"
import type { BridgeApi } from "./ops/types.ts"
import { BridgeError, type TranscriptUpdatePush } from "./protocol.ts"

const DEFAULT_DEBOUNCE_MS = 60
const WATCH_DEBOUNCE_MS = 80
const PAGE_LIMIT = 50

export interface TranscriptReadArgs {
  readonly taskId: string
  readonly tab?: string
  readonly cursor?: string
  readonly source?: "auto" | "history" | "terminal"
  readonly limit?: number
}

export interface TranscriptReadResult {
  readonly source?: "history" | "terminal"
  readonly history?: {
    readonly sessionId?: string
    readonly messages?: readonly unknown[]
    readonly firstIndex?: number
    readonly totalMessages?: number
  }
  readonly terminal?: {
    readonly tail?: readonly string[]
  }
  readonly cursor?: string | null
  readonly olderCursor?: string | null
}

export interface TranscriptFeedDeps {
  readonly readOutput: (args: TranscriptReadArgs) => Promise<TranscriptReadResult>
  /** Resolve the local transcript file path to watch for `(taskId, tab)`, or null when unavailable/remote. */
  readonly resolveWatchPath?: (taskId: string, tab?: string) => Promise<string | null>
  /** Injectable file watcher; defaults to `startFileWatchTrigger`. */
  readonly watchFile?: (filePath: string, onChange: () => void) => () => void
  readonly debounceMs?: number
}

interface Subscriber {
  cursor: string | null
  lastTailKey: string | null
  inFlight: boolean
  pendingAgain: boolean
  active: boolean
  readonly emit: (push: TranscriptUpdatePush) => void
}

interface WatchedTarget {
  readonly key: string
  readonly taskId: string
  readonly tab?: string
  readonly subscribers: Set<Subscriber>
  timer: ReturnType<typeof setTimeout> | null
  watchedPath: string | null
  stopWatch: (() => void) | null
  resolvingWatch: boolean
}

function targetKey(taskId: string, tab?: string): string {
  return `${taskId}::${tab ?? ""}`
}

function isSourceChanged(err: unknown): boolean {
  if (err instanceof BridgeError) return err.code === "SOURCE_CHANGED"
  if (err && typeof err === "object" && "code" in err && err.code === "SOURCE_CHANGED") return true
  return err instanceof Error && err.message.includes("SOURCE_CHANGED")
}

export class TranscriptFeed {
  private readonly targets = new Map<string, WatchedTarget>()
  private readonly debounceMs: number
  private readonly watchFile: (filePath: string, onChange: () => void) => () => void

  constructor(private readonly deps: TranscriptFeedDeps) {
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.watchFile =
      deps.watchFile ??
      ((filePath, onChange) =>
        startFileWatchTrigger({
          filePath,
          debounceMs: WATCH_DEBOUNCE_MS,
          onTrigger: onChange,
          onError: () => {},
        }))
  }

  /** Number of actively watched `(taskId, tab)` keys (for diagnostics & tests). */
  get watchedCount(): number {
    return this.targets.size
  }

  /** Subscribe one client connection to incremental updates for `(taskId, tab)` starting after `cursor`. */
  subscribe(
    opts: { readonly taskId: string; readonly tab?: string; readonly cursor?: string | null },
    emit: (push: TranscriptUpdatePush) => void,
  ): () => void {
    const key = targetKey(opts.taskId, opts.tab)
    let target = this.targets.get(key)
    if (!target) {
      target = {
        key,
        taskId: opts.taskId,
        ...(opts.tab ? { tab: opts.tab } : {}),
        subscribers: new Set(),
        timer: null,
        watchedPath: null,
        stopWatch: null,
        resolvingWatch: false,
      }
      this.targets.set(key, target)
      void this.ensureWatch(target)
    }

    const sub: Subscriber = {
      cursor: opts.cursor ?? null,
      lastTailKey: null,
      inFlight: false,
      pendingAgain: false,
      active: true,
      emit,
    }
    target.subscribers.add(sub)

    return () => {
      if (!sub.active) return
      sub.active = false
      const current = this.targets.get(key)
      if (!current) return
      current.subscribers.delete(sub)
      if (current.subscribers.size === 0) {
        if (current.timer) clearTimeout(current.timer)
        current.stopWatch?.()
        this.targets.delete(key)
      }
    }
  }

  /** External signal (daemon hook event, `tab.send`, status transition) that `taskId` may have new output. */
  poke(taskId: string): void {
    for (const target of this.targets.values()) {
      if (target.taskId === taskId) this.schedule(target)
    }
  }

  /** Stop all active timers and file watchers (used on shutdown/tests). */
  close(): void {
    for (const target of this.targets.values()) {
      if (target.timer) clearTimeout(target.timer)
      target.stopWatch?.()
      for (const sub of target.subscribers) sub.active = false
      target.subscribers.clear()
    }
    this.targets.clear()
  }

  private schedule(target: WatchedTarget): void {
    if (target.timer) return
    if (this.debounceMs <= 0) {
      void this.flush(target)
      return
    }
    target.timer = setTimeout(() => {
      target.timer = null
      void this.flush(target)
    }, this.debounceMs)
    target.timer.unref?.()
  }

  private async ensureWatch(target: WatchedTarget, force = false): Promise<void> {
    if (!this.deps.resolveWatchPath) return
    if (target.resolvingWatch) return
    if (!force && target.watchedPath) return
    target.resolvingWatch = true
    try {
      const nextPath = await this.deps.resolveWatchPath(target.taskId, target.tab)
      if (!this.targets.has(target.key)) return
      if (!nextPath || nextPath === target.watchedPath) return
      target.stopWatch?.()
      target.watchedPath = nextPath
      target.stopWatch = this.watchFile(nextPath, () => this.schedule(target))
    } catch {
      // Best-effort: daemon events and fallback polling still deliver updates.
    } finally {
      target.resolvingWatch = false
    }
  }

  private async flush(target: WatchedTarget): Promise<void> {
    if (!this.targets.has(target.key)) return
    if (!target.watchedPath) void this.ensureWatch(target)
    await Promise.all([...target.subscribers].map((sub) => this.flushSubscriber(target, sub)))
  }

  private async flushSubscriber(target: WatchedTarget, sub: Subscriber): Promise<void> {
    if (!sub.active) return
    if (sub.inFlight) {
      sub.pendingAgain = true
      return
    }
    sub.inFlight = true
    try {
      await this.readAndEmit(target, sub)
    } finally {
      sub.inFlight = false
      if (sub.pendingAgain && sub.active && this.targets.has(target.key)) {
        sub.pendingAgain = false
        this.schedule(target)
      }
    }
  }

  private async readAndEmit(target: WatchedTarget, sub: Subscriber): Promise<void> {
    const base = {
      taskId: target.taskId,
      ...(target.tab ? { tab: target.tab } : {}),
      limit: PAGE_LIMIT,
    }
    if (sub.cursor) {
      try {
        const res = await this.deps.readOutput({ ...base, cursor: sub.cursor, source: "history" })
        if (!sub.active || res.source !== "history" || !res.history) return
        const messages = res.history.messages ?? []
        const nextCursor = res.cursor ?? sub.cursor
        if (messages.length === 0 && nextCursor === sub.cursor) return
        sub.cursor = nextCursor
        sub.emit({
          taskId: target.taskId,
          ...(target.tab ? { tab: target.tab } : {}),
          source: "history",
          history: {
            ...(res.history.sessionId ? { sessionId: res.history.sessionId } : {}),
            messages,
            firstIndex: res.history.firstIndex ?? 0,
            ...(res.history.totalMessages !== undefined ? { totalMessages: res.history.totalMessages } : {}),
          },
          cursor: nextCursor,
          ...(res.olderCursor !== undefined ? { olderCursor: res.olderCursor } : {}),
        })
        return
      } catch (err) {
        if (!isSourceChanged(err)) return
        // Session rotated or shrank: re-watch the new file and send a clean reset page.
        void this.ensureWatch(target, true)
      }
    }

    // Fresh page (initial terminal-mode subscription or post-SOURCE_CHANGED reset).
    let fresh: TranscriptReadResult
    try {
      fresh = await this.deps.readOutput(base)
    } catch {
      return
    }
    if (!sub.active) return
    if (fresh.source === "history" && fresh.history) {
      sub.cursor = fresh.cursor ?? null
      sub.lastTailKey = null
      void this.ensureWatch(target, true)
      sub.emit({
        taskId: target.taskId,
        ...(target.tab ? { tab: target.tab } : {}),
        reset: true,
        source: "history",
        history: {
          ...(fresh.history.sessionId ? { sessionId: fresh.history.sessionId } : {}),
          messages: fresh.history.messages ?? [],
          firstIndex: fresh.history.firstIndex ?? 0,
          ...(fresh.history.totalMessages !== undefined ? { totalMessages: fresh.history.totalMessages } : {}),
        },
        cursor: sub.cursor,
        ...(fresh.olderCursor !== undefined ? { olderCursor: fresh.olderCursor } : {}),
      })
      return
    }
    const tail = fresh.terminal?.tail ?? []
    const tailKey = tail.join("\n")
    if (tailKey === sub.lastTailKey) return
    sub.lastTailKey = tailKey
    sub.emit({
      taskId: target.taskId,
      ...(target.tab ? { tab: target.tab } : {}),
      reset: true,
      source: "terminal",
      terminal: { tail },
      cursor: null,
    })
  }
}

/** Build the production `TranscriptFeed` backed by `read-output` and local transcript-file resolution. */
export function createBridgeTranscriptFeed(deps: {
  readonly api: BridgeApi
  readonly machineOf: (taskId: string) => string | undefined
}): TranscriptFeed {
  return new TranscriptFeed({
    readOutput(args) {
      const argv = [flag("task-id", args.taskId)]
      if (args.tab) argv.push(flag("tab", args.tab))
      if (args.source) argv.push(flag("source", args.source))
      if (args.cursor) argv.push(flag("cursor", args.cursor))
      if (args.limit !== undefined) argv.push(flag("limit", args.limit))
      return deps.api.verb<TranscriptReadResult>("read-output", argv)
    },
    async resolveWatchPath(taskId, tabId) {
      if (deps.machineOf(taskId) !== undefined) return null
      let task: SerializedTask
      try {
        task = (await deps.api.rpc<{ task: SerializedTask }>("task.get", { taskId })).task
      } catch {
        return null
      }
      const worktree = task.worktreePath
      if (!worktree) return null
      const tabs = readTabsSnapshot(taskId)?.tabs ?? []
      const tab = tabId ? tabs.find((t) => t.id === tabId) : canonicalEngineTab(tabs)
      const vendor = ((tab?.kind === "engine" ? tab.vendor : undefined) ?? task.vendor) as VendorId | undefined
      if (!vendor || !supportsStructuredHistory(sessionProtocol(vendor))) return null
      const reader = protocolEntry(vendor).history
      const pinnedId = tab?.kind === "engine" ? tab.sessionId : undefined
      if (pinnedId) return reader.transcriptPath(pinnedId, worktree)
      const ids = await reader.listSessionIdsForWorktree(worktree)
      const newest = ids[ids.length - 1]
      return newest ? reader.transcriptPath(newest, worktree) : null
    },
  })
}

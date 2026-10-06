/**
 * Everything the bridge asks Rove, through Rove's own code paths: `rove api`
 * verbs via `invokeVerb`, the `context` grouping via `buildContext`, and the
 * TUI's changes-pane git helpers. The bridge derives nothing itself.
 */

import { isAbsolute, normalize } from "node:path"
import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { AttentionInboxItem } from "@sma1lboy/rove-daemon/daemon/contracts"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { type ActivityEntry, buildContext } from "@sma1lboy/rove/src/cli/api/context-view.ts"
import { defaultApiRuntime } from "@sma1lboy/rove/src/cli/api/runtime.ts"
import type { TaskTabRow } from "@sma1lboy/rove/src/cli/api/tab-snapshot.ts"
import {
  type RowTokenMap,
  type WorktreeChangesMap,
  liveRowTokens,
} from "@sma1lboy/rove/src/client/remote-orchestrator.ts"
import { detectEngineStatus } from "@sma1lboy/rove/src/engine/engine-status.ts"
import { engineEntry } from "@sma1lboy/rove/src/engine/registry.ts"
import { getSavedRepos } from "@sma1lboy/rove/src/state/repos.ts"
import { DEFAULT_GLYPHS } from "@sma1lboy/rove/src/tui/lib/glyphs.ts"
import { loadPreviewData } from "@sma1lboy/rove/src/tui/ops/preview-core.ts"
import {
  type StatusEntry,
  resolveBase,
  statusFiles,
  statusFilesBranch,
} from "@sma1lboy/rove/src/tui/panes/filetree/git.ts"
import { prChip } from "@sma1lboy/rove/src/tui/panes/sidebar/row-chips.ts"
import type { VendorId } from "@sma1lboy/rove/src/types/vendor.ts"
import { createBridgeApi } from "./ops/api.ts"
import {
  BridgeError,
  type DiffFileRow,
  type PrChipKind,
  type RowChanges,
  type RowTokenChip,
  type TabRow,
  type TaskRow,
  type TasksPayload,
} from "./protocol.ts"

export interface EngineRow {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly protocol: string
  readonly builtin: boolean
  /** engine-list `models`: suggestions in the engine's own spelling; `null` = unknown. */
  readonly models?: ReadonlyArray<{ readonly id: string; readonly name?: string }> | null
  /** Reasoning levels the engine declares; `[]` = takes none. */
  readonly effortLevels?: readonly string[]
  /** Binary present and, where Rove can read the login, signed in (`engine-status.ts`). Absent = could not probe. */
  readonly ready?: boolean
}

/** The bridge's whole view of Rove. Faked in tests. */
export interface RoveOps {
  tasks(): Promise<TasksPayload>
  engines(): Promise<readonly EngineRow[]>
  repos(): Promise<readonly string[]>
  createTask(input: { repo: string; engine?: string; prompt?: string; title?: string }): Promise<{ taskId: string }>
  deleteTask(taskId: string, force: boolean): Promise<{ status: string }>
  landTask(taskId: string, strategy: "merge" | "squash"): Promise<{ landedOn: string; commit: string }>
  tabs(taskId: string): Promise<readonly TabRow[]>
  newTab(taskId: string, prompt: string, engine?: string): Promise<{ tabId: string }>
  closeTab(taskId: string, tabId: string): Promise<void>
  worktreeOf(taskId: string): Promise<string>
  diffFiles(taskId: string): Promise<{ base: string | null; files: readonly DiffFileRow[] }>
  diffFile(taskId: string, path: string, scope: "branch" | "working"): Promise<unknown>
  dismissAttention(taskId: string, tabId?: string): Promise<void>
}

/** `rove api` refusals carry a stable `code`; keep it on the wire. */
function verb<T>(client: RoveDaemonClient, name: string, argv: readonly string[]): Promise<T> {
  return createBridgeApi(client).verb<T>(name, argv)
}

async function tryRead<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

/** Engine-list is a PATH scan; a minute of staleness is fine for a picker. */
const ENGINE_CACHE_MS = 60_000

/** Name a task's engine from the registry: its exact preset, else its protocol's builtin. */
export function engineFor(task: SerializedTask, engines: readonly EngineRow[]): TaskRow["engine"] {
  const command = task.command?.trim()
  const preset =
    (command ? engines.find((e) => e.id === command || e.command === command) : undefined) ??
    engines.find((e) => e.builtin && e.protocol === task.vendor)
  if (preset) return { id: preset.id, name: preset.name }
  return task.vendor ? { id: null, name: task.vendor } : null
}

/** Live feeds the rows join beyond `task.list`: both come from the daemon pushes the orchestrator already holds. */
export interface RowExtras {
  readonly changes: WorktreeChangesMap | null
  readonly tokens: RowTokenMap
}

/** `worktree.changes` for one row: absent when not collected (never zeros), `unreadable` for a tracked path git could not read. */
function rowChanges(map: WorktreeChangesMap | null, worktreePath: string): RowChanges | undefined {
  if (!map || !map.has(worktreePath)) return undefined
  const c = map.get(worktreePath)
  if (!c) return { unreadable: true }
  return {
    added: c.added,
    deleted: c.deleted,
    ...(c.ahead !== undefined ? { ahead: c.ahead } : {}),
    ...(c.behind !== undefined ? { behind: c.behind } : {}),
  }
}

function rowTokenChips(map: RowTokenMap | undefined, taskId: string, now: number): RowTokenChip[] {
  return liveRowTokens(map, taskId, now).map((t) => ({
    text: t.text,
    ...(t.tone ? { tone: t.tone } : {}),
    source: t.source,
    expiresAt: t.expiresAt,
  }))
}

const PR_CHIP_BY_GLYPH: Record<string, PrChipKind> = {
  [DEFAULT_GLYPHS.conflict]: "conflict",
  [DEFAULT_GLYPHS.checksFailing]: "failing",
  [DEFAULT_GLYPHS.checksPassing]: "passing",
}

/** The sidebar's one PR chip, straight from `row-chips.ts` (conflict > failing > passing), named instead of drawn. */
function prChipKind(task: SerializedTask): PrChipKind | null {
  const chip = prChip(task as unknown as Parameters<typeof prChip>[0])
  return chip ? (PR_CHIP_BY_GLYPH[chip.glyph] ?? null) : null
}

/** Fold `context`'s grouping over EVERY task (main/dir included) and join display fields. */
export function taskRows(
  tasks: readonly SerializedTask[],
  activity: Readonly<Record<string, ActivityEntry>> | null,
  liveTaskIds: ReadonlySet<string> | null,
  engines: readonly EngineRow[],
  now: number,
  extras?: RowExtras,
): TaskRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const orderOf = new Map(tasks.map((t, i) => [t.id, i]))
  const context = buildContext({
    repo: "",
    tasks,
    activity,
    liveTaskIds,
    attention: [],
    notes: [],
    now,
    limit: Number.MAX_SAFE_INTEGER,
  })
  return context.tasks.flatMap((row): TaskRow[] => {
    const task = byId.get(row.taskId)
    if (!task) return []
    const pr = task.prStatus
    const changes = rowChanges(extras?.changes ?? null, task.worktreePath)
    const tokens = rowTokenChips(extras?.tokens, task.id, now)
    const chip = prChipKind(task)
    return [
      {
        id: task.id,
        title: task.title,
        branch: task.branch,
        repo: task.repo,
        kind: task.kind ?? "task",
        status: task.status,
        group: row.group,
        rank: row.rank,
        activity: row.activity ? { ...row.activity, since: now - row.activity.forMs } : null,
        engine: engineFor(task, engines),
        pr: pr
          ? {
              ...(pr.number !== undefined ? { number: pr.number } : {}),
              ...(pr.url ? { url: pr.url } : {}),
              lifecycle: pr.lifecycle,
              checkState: pr.checkState,
              ...(pr.reviewDecision ? { reviewDecision: pr.reviewDecision } : {}),
              ...(pr.mergeable ? { mergeable: pr.mergeable } : {}),
            }
          : null,
        report: task.report ? { summary: task.report.summary ?? "", at: task.report.at } : null,
        deleting: task.deletion?.phase === "queued" || task.deletion?.phase === "running",
        pinned: task.pinned === true,
        order: orderOf.get(task.id) ?? 0,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        ...(changes ? { changes } : {}),
        ...(tokens.length > 0 ? { rowTokens: tokens } : {}),
        prChip: chip,
        prChipStale: chip !== null && pr?.lastError !== undefined,
      },
    ]
  })
}

/** Untracked directories arrive as one row with children; the phone wants files. */
function flatten(entries: readonly StatusEntry[], scope: DiffFileRow["scope"]): DiffFileRow[] {
  return entries.flatMap((e): DiffFileRow[] =>
    e.children?.length
      ? flatten(e.children, scope)
      : [{ path: e.path, status: e.status, added: e.added ?? null, deleted: e.deleted ?? null, scope }],
  )
}

/** Optional live signals the feed joins into rows (the orchestrator's `worktree.changes` and `task.tokens` pushes). */
export interface LiveRowSignals {
  changes(): WorktreeChangesMap | null
  tokens(): RowTokenMap
}

export function createRoveOps(client: RoveDaemonClient, signals?: LiveRowSignals): RoveOps {
  let engineCache: { at: number; engines: readonly EngineRow[] } | null = null

  const engines = async (): Promise<readonly EngineRow[]> => {
    if (engineCache && Date.now() - engineCache.at < ENGINE_CACHE_MS) return engineCache.engines
    const res = await verb<{ engines: ReadonlyArray<EngineRow> }>(client, "engine-list", [])
    const rows = await Promise.all(
      res.engines.map(async ({ id, name, command, protocol, builtin, models }) => {
        // `engine-status.ts`: binary found AND (where Rove can read the login) an account exists.
        const status = await tryRead(() => detectEngineStatus(id as VendorId))
        return {
          id,
          name,
          command,
          protocol,
          builtin,
          models: models ?? null,
          effortLevels: [...(engineEntry(protocol).effortLevels ?? [])],
          ...(status ? { ready: status.binary.found && status.account?.kind !== "none" } : {}),
        }
      }),
    )
    engineCache = { at: Date.now(), engines: rows }
    return rows
  }

  const getTask = async (taskId: string): Promise<SerializedTask> => {
    const res = await verb<{ task: SerializedTask }>(client, "get-task", ["--task-id", taskId])
    return res.task
  }

  const worktreeOf = async (taskId: string): Promise<string> => {
    const task = await getTask(taskId)
    if (!task.worktreePath) throw new BridgeError("NO_WORKTREE", `task ${taskId} has no worktree yet`)
    return task.worktreePath
  }

  return {
    async tasks() {
      const { tasks } = await client.request<{ tasks: SerializedTask[] }>("task.list")
      const [inspect, inbox, live, engineRows] = await Promise.all([
        tryRead(() => client.request<{ activity?: { tasks?: Record<string, ActivityEntry> } }>("debug.inspect")),
        tryRead(() => client.request<{ items: AttentionInboxItem[] }>("attention.list")),
        tryRead(() => defaultApiRuntime.liveTaskIds()),
        tryRead(engines),
      ])
      return {
        tasks: taskRows(
          tasks,
          inspect?.activity?.tasks ?? null,
          live,
          engineRows ?? [],
          Date.now(),
          signals ? { changes: signals.changes(), tokens: signals.tokens() } : undefined,
        ),
        attention: (inbox?.items ?? []).map((i) => ({
          taskId: i.taskId,
          tabId: i.tabId,
          state: i.state,
          unread: i.unread,
          at: i.at,
        })),
      }
    },

    engines,

    async repos() {
      const { tasks } = await client.request<{ tasks: SerializedTask[] }>("task.list")
      return [...new Set([...getSavedRepos(), ...tasks.map((t) => t.repo)])].sort()
    },

    async createTask({ repo, engine, prompt, title }) {
      const argv = ["--repo", repo]
      if (engine) argv.push("--command", engine)
      if (title) argv.push("--title", title)
      if (prompt) argv.push("--prompt", prompt)
      const res = await verb<{ taskId: string }>(client, "add", argv)
      return { taskId: res.taskId }
    },

    async deleteTask(taskId, force) {
      const argv = ["--task-id", taskId, "--wait"]
      if (force) argv.push("--force")
      const res = await verb<{ status?: string; queued?: boolean }>(client, "delete", argv)
      return { status: res.status ?? (res.queued ? "queued" : "removed") }
    },

    async landTask(taskId, strategy) {
      const res = await verb<{ landedOn: string; commit: string }>(client, "land", [
        "--task-id",
        taskId,
        "--strategy",
        strategy,
      ])
      return { landedOn: res.landedOn, commit: res.commit }
    },

    async tabs(taskId) {
      const [res, engineRows] = await Promise.all([
        verb<{ tabs?: readonly TaskTabRow[] }>(client, "get-task", ["--task-id", taskId]),
        tryRead(engines),
      ])
      const nameOf = (vendor: string | null): string | null =>
        vendor ? (engineRows?.find((e) => e.builtin && e.protocol === vendor)?.name ?? vendor) : null
      return (res.tabs ?? []).map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title ?? t.lastTitle ?? t.autoTitle,
        engineName: t.kind === "engine" ? nameOf(t.liveVendor ?? t.vendor) : null,
        alive: t.alive,
        engineAlive: t.engineAlive,
      }))
    },

    async newTab(taskId, prompt, engine) {
      const argv = ["--task-id", taskId, "--tab", "new", "--plain", "--prompt", prompt]
      if (engine) argv.push("--command", engine)
      const res = await verb<{ session?: string }>(client, "send", argv)
      const tabId = res.session?.split("::")[1]
      if (!tabId) throw new BridgeError("SESSION_FAILED", "the new tab did not report its session")
      return { tabId }
    },

    async closeTab(taskId, tabId) {
      await verb<unknown>(client, "tab-close", ["--task-id", taskId, "--tab", tabId])
    },

    worktreeOf,

    async diffFiles(taskId) {
      const task = await getTask(taskId)
      if (!task.worktreePath) return { base: null, files: [] }
      // Same base ladder as the TUI changes pane (PR base first).
      const base = await resolveBase(task.worktreePath, task.prStatus?.baseRef)
      const [branch, working] = await Promise.all([
        base ? statusFilesBranch(task.worktreePath, base) : Promise.resolve([]),
        statusFiles(task.worktreePath),
      ])
      return { base, files: [...flatten(branch, "branch"), ...flatten(working, "working")] }
    },

    async diffFile(taskId, path, scope) {
      // git scopes the diff to the worktree, but a `code` preview reads the
      // file itself: refuse anything that could name a file outside it.
      if (isAbsolute(path) || normalize(path).split(/[\\/]/).includes("..")) {
        throw new BridgeError("BAD_ARGS", "path must be relative to the worktree")
      }
      const task = await getTask(taskId)
      if (!task.worktreePath) throw new BridgeError("NO_WORKTREE", `task ${taskId} has no worktree yet`)
      if (scope === "working") return loadPreviewData(task.worktreePath, path)
      const base = await resolveBase(task.worktreePath, task.prStatus?.baseRef)
      if (!base) throw new BridgeError("NO_BASE", "could not resolve a base branch for this task")
      return loadPreviewData(task.worktreePath, path, { base })
    },

    async dismissAttention(taskId, tabId) {
      await client.request("attention.dismiss", tabId ? { taskId, tabId } : { taskId })
    },
  }
}

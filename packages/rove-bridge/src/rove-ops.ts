/**
 * Everything the bridge asks Rove, through Rove's own code paths: `rove api`
 * verbs via `invokeVerb`, the `context` grouping via `buildContext`, the
 * daemon's row status (`row.status`), and the TUI's changes-pane git helpers.
 * The bridge derives nothing itself.
 */

import { isAbsolute, normalize } from "node:path"
import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { AttentionInboxItem } from "@sma1lboy/rove-daemon/daemon/contracts"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { ActivityEntry } from "@sma1lboy/rove/src/cli/api/context-view.ts"
import type { TaskTabRow } from "@sma1lboy/rove/src/cli/api/tab-snapshot.ts"
import type { ActiveGate, RowTokenMap, WorktreeChangesMap } from "@sma1lboy/rove/src/client/remote-orchestrator.ts"
import { detectEngineStatus } from "@sma1lboy/rove/src/engine/engine-status.ts"
import { engineDisplayName } from "@sma1lboy/rove/src/engine/interactive-command.ts"
import { engineEntry } from "@sma1lboy/rove/src/engine/registry.ts"
import { getSavedRepos } from "@sma1lboy/rove/src/state/repos.ts"
import { loadStateFile } from "@sma1lboy/rove/src/state/store.ts"
import { terminalTabsKey } from "@sma1lboy/rove/src/tui-react/workspace/terminal-tabs-persist.ts"
import { loadPreviewData } from "@sma1lboy/rove/src/tui/ops/preview-core.ts"
import { resolveBase } from "@sma1lboy/rove/src/tui/panes/filetree/git.ts"
import type { TerminalTab } from "@sma1lboy/rove/src/tui/workspace/terminal-tabs-core.ts"
import type { VendorId } from "@sma1lboy/rove/src/types/vendor.ts"
import { type WorktreeDiff, worktreeDiff } from "@sma1lboy/rove/src/worktree/review-read.ts"
import { gateRows } from "./gates.ts"
import { createBridgeApi } from "./ops/api.ts"
import { flag } from "./ops/args.ts"
import type { BridgeApi } from "./ops/types.ts"
import { BridgeError, type DiffFileRow, type TabRow, type TasksPayload } from "./protocol.ts"
import type { RowStatuses } from "./row-status.ts"
import { attentionRows, remoteRowStatus, taskRows } from "./task-rows.ts"

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
  /** The engine has a model flag, so a model can be pinned for it (`modelArgv` in the engine registry). */
  readonly acceptsModel?: boolean
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
  landTask(
    taskId: string,
    strategy: "merge" | "squash",
  ): Promise<{
    landedOn: string
    commit: string
    /** Set when the task lives on another machine: its branch was pushed and a PR opened there. */
    published?: { branch: string; prUrl: string | null; prError: string | null }
  }>
  tabs(taskId: string): Promise<readonly TabRow[]>
  newTab(taskId: string, tab: NewTabRequest): Promise<{ tabId: string }>
  closeTab(taskId: string, tabId: string): Promise<void>
  worktreeOf(taskId: string): Promise<string>
  /** A viewport tab shows another task's first engine session: where to attach instead; null for any other tab. */
  viewedSession(taskId: string, tabId: string): { taskId: string; tabId: string; cwd: string } | null
  /** The registered machine a task lives on; undefined = this machine. */
  machineOf?(taskId: string): string | undefined
  diffFiles(taskId: string): Promise<{ base: string | null; files: readonly DiffFileRow[] }>
  diffFile(taskId: string, path: string, scope: "branch" | "working"): Promise<unknown>
  dismissAttention(taskId: string, tabId?: string, deliveryId?: string): Promise<void>
}

/** What `tab.new` asks for: no `prompt` opens the tab empty (a shell, or an engine awaiting its first message). */
export interface NewTabRequest {
  readonly kind: "shell" | "engine"
  readonly prompt?: string
  /** Engine id for an engine tab; omitted = the task's own. */
  readonly engine?: string
  /** No engine named: the one this project used last (the TUI's ctrl+t), not the task's own. */
  readonly latest?: boolean
}

/** A prompt starts the engine on it (`send`); without one there is nothing to send, so `tab-new` opens the tab empty. */
export function newTabInvocation(
  taskId: string,
  tab: NewTabRequest,
): { readonly verb: "send" | "tab-new"; readonly argv: readonly string[] } {
  const command = tab.engine ? [flag("command", tab.engine)] : []
  if (tab.prompt === undefined && !tab.engine && tab.latest) command.push("--latest")
  if (tab.prompt !== undefined) {
    return {
      verb: "send",
      argv: [flag("task-id", taskId), "--tab=new", "--plain", flag("prompt", tab.prompt), ...command],
    }
  }
  return { verb: "tab-new", argv: [flag("task-id", taskId), flag("kind", tab.kind), ...command] }
}

/** `rove api` refusals carry a stable `code`; keep it on the wire. */
/**
 * `get-task` tab rows as the bridge reports them, each with the daemon's status of that tab when it
 * has one. Names only: the full engine list probes every binary, seconds on a cold bridge.
 */
export function tabRows(rows: readonly TaskTabRow[], statuses?: RowStatuses[string]["tabs"]): TabRow[] {
  const nameOf = (vendor: string | null): string | null => (vendor ? engineDisplayName(vendor as VendorId) : null)
  return rows.map((t) => ({
    id: t.id,
    kind: t.kind,
    title: t.title ?? t.lastTitle ?? t.autoTitle,
    engineName: t.kind === "engine" ? nameOf(t.liveVendor ?? t.vendor) : null,
    // Only a running engine: the TUI's two-row caption reads the pty's foreground process, never the configured one.
    liveEngine: t.kind === "engine" && t.alive !== false ? nameOf(t.liveVendor) : null,
    alive: t.alive,
    engineAlive: t.engineAlive,
    ...(t.split ? { split: t.split } : {}),
    ...(t.viewOf ? { viewOf: t.viewOf } : {}),
    ...(statuses?.[t.id] ? { status: statuses[t.id] } : {}),
  }))
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

/** Optional live signals the feed joins into rows (the orchestrator's `worktree.changes` and `task.tokens` pushes). */
export interface LiveRowSignals {
  changes(): WorktreeChangesMap | null
  tokens(): RowTokenMap
  /** The daemon's `gates` channel: open decisions and answered ones still owed to the engine. */
  gates(): readonly ActiveGate[]
  /** The daemon's `row.status` (`RowStatusFeed`): every row's status and its tabs'; null before the first answer. */
  rowStatus?(): RowStatuses | null
  /** Tasks of the other registered machines (`MachineHub`), each stamped with its `origin`. */
  remote?(): readonly SerializedTask[]
  /** What those machines' daemons push about their tasks (`MachineHub.liveSignal`). */
  remoteLive?(): {
    readonly activity: ReadonlyMap<string, ActivityEntry>
    readonly changes: WorktreeChangesMap | null
    readonly tokens: RowTokenMap
  }
}

/**
 * `api` runs the verbs; give it the hub's {@link RemoteVerbs} (`createBridgeApi(client, remote)`) and
 * every verb-backed op — tabs, tab-new/close, get-task — serves a task on another machine as well.
 */
export function createRoveOps(
  client: RoveDaemonClient,
  signals?: LiveRowSignals,
  api: BridgeApi = createBridgeApi(client),
): RoveOps {
  let engineCache: { at: number; engines: readonly EngineRow[] } | null = null
  // One cold load at a time: every `task.tabs` needs the list, and a client fans those out per task.
  let engineLoad: Promise<readonly EngineRow[]> | null = null

  const engines = (): Promise<readonly EngineRow[]> => {
    if (engineCache && Date.now() - engineCache.at < ENGINE_CACHE_MS) return Promise.resolve(engineCache.engines)
    engineLoad ??= loadEngines().finally(() => {
      engineLoad = null
    })
    return engineLoad
  }

  const loadEngines = async (): Promise<readonly EngineRow[]> => {
    const res = await api.verb<{ engines: ReadonlyArray<EngineRow> }>("engine-list", [])
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
          acceptsModel: engineEntry(protocol).modelArgv !== undefined,
          ...(status ? { ready: status.binary.found && status.account?.kind !== "none" } : {}),
        }
      }),
    )
    engineCache = { at: Date.now(), engines: rows }
    return rows
  }

  const getTask = async (taskId: string): Promise<SerializedTask> => {
    const res = await api.verb<{ task: SerializedTask }>("get-task", [flag("task-id", taskId)])
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
      const [inbox, engineRows] = await Promise.all([
        tryRead(() => client.request<{ items: AttentionInboxItem[] }>("attention.list")),
        tryRead(engines),
      ])
      const now = Date.now()
      const statuses = signals?.rowStatus?.() ?? null
      const local = taskRows(
        tasks,
        statuses ? { tasks: statuses, liveness: true } : null,
        engineRows ?? [],
        now,
        signals ? { changes: signals.changes(), tokens: signals.tokens() } : undefined,
      )
      // Other machines' rows: engine state, changes and tokens as their daemons push them through the hub.
      // Liveness (which tabs run) lives in their pty hosts, so that stays unknown here.
      const pushed = signals?.remoteLive?.()
      const remote = taskRows(
        signals?.remote?.() ?? [],
        pushed ? remoteRowStatus(pushed.activity) : null,
        engineRows ?? [],
        now,
        pushed ? { changes: pushed.changes, tokens: pushed.tokens } : undefined,
      ).map((row) => ({
        ...row,
        order: (row.order ?? 0) + tasks.length,
      }))
      return {
        tasks: [...local, ...remote],
        attention: attentionRows(inbox?.items ?? [], tasks),
        gates: gateRows(signals?.gates() ?? [], tasks),
      }
    },

    engines,

    async repos() {
      const { tasks } = await client.request<{ tasks: SerializedTask[] }>("task.list")
      return [...new Set([...getSavedRepos(), ...tasks.map((t) => t.repo)])].sort()
    },

    async createTask({ repo, engine, prompt, title }) {
      const argv = [flag("repo", repo)]
      if (engine) argv.push(flag("command", engine))
      if (title) argv.push(flag("title", title))
      if (prompt) argv.push(flag("prompt", prompt))
      const res = await api.verb<{ taskId: string }>("add", argv)
      return { taskId: res.taskId }
    },

    async deleteTask(taskId, force) {
      const argv = [flag("task-id", taskId), "--wait"]
      if (force) argv.push("--force")
      const res = await api.verb<{ status?: string; queued?: boolean }>("delete", argv)
      return { status: res.status ?? (res.queued ? "queued" : "removed") }
    },

    async landTask(taskId, strategy) {
      // Another machine's task is published there (push + PR) rather than merged: see `publish`.
      const res = await api.verb<{
        landedOn?: string
        commit?: string
        branch?: string
        pr?: { url: string } | null
        prError?: string
      }>("land", [flag("task-id", taskId), flag("strategy", strategy)])
      if (res.landedOn !== undefined) return { landedOn: res.landedOn, commit: res.commit ?? "" }
      return {
        landedOn: res.pr?.url ?? `${res.branch ?? "branch"} (pushed)`,
        commit: "",
        published: { branch: res.branch ?? "", prUrl: res.pr?.url ?? null, prError: res.prError ?? null },
      }
    },

    async tabs(taskId) {
      const res = await api.verb<{ tabs?: readonly TaskTabRow[] }>("get-task", [flag("task-id", taskId)])
      return tabRows(res.tabs ?? [], signals?.rowStatus?.()?.[taskId]?.tabs)
    },

    async newTab(taskId, tab) {
      const call = newTabInvocation(taskId, tab)
      const res = await api.verb<{ tabId?: string; session?: string }>(call.verb, call.argv)
      const tabId = res.tabId ?? res.session?.split("::")[1]
      if (!tabId) throw new BridgeError("SESSION_FAILED", "the new tab did not report its session")
      return { tabId }
    },

    async closeTab(taskId, tabId) {
      await api.verb<unknown>("tab-close", [flag("task-id", taskId), flag("tab", tabId)])
    },

    worktreeOf,

    viewedSession(taskId, tabId) {
      const snapshot = loadStateFile()[terminalTabsKey(taskId)] as { tabs?: TerminalTab[] } | undefined
      const tab = snapshot?.tabs?.find((t) => t.id === tabId)
      return tab?.kind === "engine" && tab.ptyTask
        ? { taskId: tab.ptyTask.id, tabId: "tab-1", cwd: tab.ptyTask.worktree }
        : null
    },

    machineOf: (taskId) => api.machineOf?.(taskId),

    async diffFiles(taskId) {
      // Another machine's worktree is read there: its git, its files.
      if (api.machineOf?.(taskId)) {
        // A task that has not started has no worktree on either machine: no changes, as below.
        return api.verb<WorktreeDiff>("worktree-diff", [flag("task-id", taskId)]).catch((err: unknown) => {
          if (err instanceof BridgeError && err.code === "NO_WORKTREE") return { base: null, files: [] }
          throw err
        })
      }
      const task = await getTask(taskId)
      if (!task.worktreePath) return { base: null, files: [] }
      return worktreeDiff(task.worktreePath, task.prStatus?.baseRef)
    },

    async diffFile(taskId, path, scope) {
      // git scopes the diff to the worktree, but a `code` preview reads the
      // file itself: refuse anything that could name a file outside it.
      if (isAbsolute(path) || normalize(path).split(/[\\/]/).includes("..")) {
        throw new BridgeError("BAD_ARGS", "path must be relative to the worktree")
      }
      if (api.machineOf?.(taskId)) {
        return api.verb<unknown>("worktree-diff-file", [
          flag("task-id", taskId),
          flag("path", path),
          flag("scope", scope),
        ])
      }
      const task = await getTask(taskId)
      if (!task.worktreePath) throw new BridgeError("NO_WORKTREE", `task ${taskId} has no worktree yet`)
      if (scope === "working") return loadPreviewData(task.worktreePath, path)
      const base = await resolveBase(task.worktreePath, task.prStatus?.baseRef)
      if (!base) throw new BridgeError("NO_BASE", "could not resolve a base branch for this task")
      return loadPreviewData(task.worktreePath, path, { base })
    },

    async dismissAttention(taskId, tabId, deliveryId) {
      await client.request("attention.dismiss", {
        taskId,
        ...(tabId ? { tabId } : {}),
        ...(deliveryId ? { deliveryId } : {}),
      })
    },
  }
}

export { attentionRows, engineFor, remoteRowStatus, taskRows, type RowExtras } from "./task-rows.ts"

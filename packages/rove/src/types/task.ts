/**
 * Task data model. Tasks persist worktree and lifecycle metadata; terminal
 * tabs and Hosted PTY sessions have their own owners, and engine conversation
 * ids stay engine-owned on disk. The store migrates v1/v2 manifests to v3 on
 * load; downgrading is not supported.
 */

declare const TaskIdBrand: unique symbol
export type TaskId = string & { readonly [TaskIdBrand]: never }

/** Caller asserts a ULID; no runtime validation (validators live in the orchestrator). */
export const toTaskId = (id: string): TaskId => id as TaskId

export type { VendorId } from "./vendor.ts"
import type {
  TaskDeletionState,
  TaskDispatcher,
  TaskExtraRepo,
  TaskLinkedWorkItem,
  TaskPRStatus,
  TaskPtyAlias,
  TaskQuotaResumeState,
  TaskStatus,
  TaskWorkerReport,
} from "@sma1lboy/rove-daemon/daemon/contracts"
import type { ObservedLanguage } from "@sma1lboy/rove-daemon/prompts/observed-language"
import type { VendorId } from "./vendor.ts"

export type {
  TaskDeletionState,
  TaskDispatcher,
  TaskLinkedWorkItem,
  TaskPRStatus,
  TaskPtyAlias,
  TaskQuotaResumeState,
  TaskStatus,
  TaskWorkerReport,
  TaskExtraRepo,
}

/** Engine vendor for a task that records none. */
export const DEFAULT_TASK_VENDOR: VendorId = "claude"

/** Every {@link TaskStatus} at runtime, for wire-boundary validation via {@link isTaskStatus}. */
export const TASK_STATUSES = [
  "backlog",
  "in_progress",
  "in_review",
  "done",
  "canceled",
  "error",
] as const satisfies readonly TaskStatus[]

// Exhaustiveness: if a member is added to TaskStatus but not to TASK_STATUSES,
// `Exclude` is non-`never` and this `satisfies` fails to compile.
true satisfies Exclude<TaskStatus, (typeof TASK_STATUSES)[number]> extends never ? true : false

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value)
}

export type PRCheckState = TaskPRStatus["checkState"]
export type PRLifecycleState = TaskPRStatus["lifecycle"]

export type TaskDeletionPhase = TaskDeletionState["phase"]

/** Back-pointer from a routine's standing session task to its schedule. */
export interface TaskRoutineLink {
  /** `Automation.id`. Survives the routine being renamed or rescheduled. */
  readonly automationId: string
}

/**
 * One task, stored in `~/.rove/tasks.json` ({@link TaskIndex}).
 *
 * - `id` is a ULID (sortable, time-prefixed).
 * - `repo` is the absolute path of the source repo's working tree, not the
 *   per-task worktree (`worktreePath`).
 * - `worktreePath` is absolute; may not exist yet while in `backlog`. Equals
 *   `repo` for `kind: "main"`.
 * - `createdAt` / `updatedAt` are ISO-8601 UTC.
 */
export interface Task {
  readonly id: TaskId
  readonly title: string
  readonly repo: string
  readonly branch: string
  readonly worktreePath: string
  /**
   * `"main"`: a saved repo's root checkout (`worktreePath === repo`,
   * `branch === ""`). `"task"`: a per-task worktree under
   * `~/.rove/worktrees/<repo-key>/<slug>/` (older records: `.rove/worktrees`,
   * `.claude/worktrees`). `"dir"` (`rove .`): an existing directory, same
   * `worktreePath`/`branch` shape as main, no project; deletion drops only the
   * index entry, never the directory. Absent normalizes to `"task"` on load.
   */
  readonly kind?: "main" | "task" | "dir"
  /**
   * Scratch shell: a `kind: "dir"` task with an unsettled cwd, shown in the
   * sidebar's Scratch section. Its shell exiting deletes the row. Cleared on
   * rename (`setTitle`) or when its live cwd + a detected harness move it into
   * a project (`adoptScratchRepo`).
   */
  readonly scratch?: boolean
  /** A `dir` task the daemon made for a projectless routine; sorts into the No project group. */
  readonly noProject?: boolean
  /**
   * The routine (`Automation`, `persistentSession`) this task is the standing
   * session for; every firing re-delivers here. The sidebar folds these behind
   * a per-project count row (7 daily routines would add 49 rows a week);
   * otherwise ordinary (selectable, Inbox, `rove api`). Absent on routine
   * tasks created before the field, which keep rendering as loose rows.
   */
  readonly routine?: TaskRoutineLink
  readonly status: TaskStatus
  /** Floats to the top of the sidebar's task list. Defaults to `false` on load. */
  readonly pinned?: boolean
  /**
   * Hidden from the sidebar and the default `rove api list` while the worktree,
   * branch and sessions stay as they were. Set on a task and its descendants
   * together; undone the same way.
   */
  readonly archived?: boolean
  /**
   * Engine protocol: which history reader parses this task's transcript.
   * Absent normalizes to {@link DEFAULT_TASK_VENDOR}. Derived from
   * {@link command}'s argv[0] (`engine/engine-presets.ts`); an unnameable
   * command records the generic protocol until a live session is sniffed.
   * Records without `command` carry a preset id here and launch from it.
   */
  readonly vendor?: VendorId
  /**
   * Raw launch command as given to `add --command` / `update --command`: a preset
   * id (its `engineCommand.<id>` override still applies) or a full command
   * line. Absent = launch from {@link vendor}.
   */
  readonly command?: string
  readonly prStatus?: TaskPRStatus
  /**
   * Effort level, when the vendor has them (codex:
   * `none`/`low`/`medium`/`high`/`xhigh`/`max`; claude: undefined). Mapped to
   * the vendor's flag in `interactive-command.ts`.
   */
  readonly modelEffort?: string
  /**
   * Model in the engine's own spelling, passed via the protocol's `modelArgv`
   * (`interactive-command.ts`). Absent = engine default. Only engines
   * declaring `modelArgv` record one (`BAD_MODEL` otherwise), so it is never
   * silently dropped.
   */
  readonly model?: string
  /**
   * Auto-routing tier picked at creation (`swift` / `standard` / `deep`) that
   * filled engine/model/effort; kept verbatim as a weak training label.
   * Absent = engine chosen by hand.
   */
  readonly tier?: string
  /** ULID shared by all siblings of one `rove api fan-out` call; single tasks never get one. */
  readonly groupId?: string
  /**
   * Language observed from the user's prompts (`prompts/observed-language.ts`),
   * not a setting. Used for text Rove injects with no user message in hand
   * (timer-fired quota resume, the Create-PR prompt). Absent means English.
   */
  readonly observedLanguage?: ObservedLanguage
  /** Present while background deletion is queued/running or after it failed. */
  readonly deletion?: TaskDeletionState
  /** Present while a rate-limited engine waits for its quota window to reset. */
  readonly quotaResume?: TaskQuotaResumeState
  /** The external tracker item this task was started from, when it was. */
  readonly linkedWorkItem?: TaskLinkedWorkItem
  /** The rove session (task + tab) that dispatched this task, when one did. */
  readonly dispatcher?: TaskDispatcher
  /**
   * Tree lineage: the task this one was spawned from. Distinct from
   * {@link dispatcher}, which only routes reports back.
   */
  readonly parentTaskId?: TaskId
  /**
   * Set on a child running in another task's directory (that task = the
   * workspace owner, never itself a sharer). A shared child of a `main`/`dir`
   * parent is `kind: "dir"`; of a managed `task` parent it is `kind: "task"`
   * carrying the owner's `worktreePath` + `branch`. It never owns the
   * directory: not promoted to main, not a project of its own, and deleting it
   * never removes the directory.
   */
  readonly sharesWorkspaceOf?: TaskId
  /**
   * Engine cwd relative to {@link worktreePath} (a worktree child spawned from
   * a git subdirectory). `worktreePath` stays the worktree ROOT; join the two
   * with `taskCwd`.
   */
  readonly cwdSubpath?: string
  /**
   * Only on a migrated child whose live hosted PTY is still keyed under its
   * parent (`<taskId>::<tabId>`): that PTY session IS this task's
   * conversation, so attach/send/activity/hooks all resolve there.
   */
  readonly ptyAlias?: TaskPtyAlias
  /**
   * A row that shared this directory was deleted with `deleteBranch` while this
   * one still held the branch; the request waits here for the last row.
   */
  readonly deleteBranchPending?: boolean
  /** Every prompt sent to this task arms a delivery that must end in `rove api report`. */
  readonly requireReport?: boolean
  /**
   * The brief `add --prompt` delivered, recorded on the delivery path because
   * the engine transcript isn't durable. Verbatim, never truncated: the key
   * constraints often sit at the end of a long brief.
   */
  readonly prompt?: string
  /**
   * Base ref the branch was cut from (`add --base-branch`). Persisted so
   * `collect`'s ahead count / diffstat use the real fork point, not the
   * `origin/HEAD` → `main` → `master` guess (the fallback when absent), and
   * so a daemon restart before lazy worktree creation can't drop it.
   */
  readonly baseRef?: string
  /**
   * Worktree directory name (`add --worktree-name`) instead of an animal-pool
   * pick. Persisted because allocation is lazy (first enter, maybe a later
   * daemon process). Absent = generated name.
   */
  readonly worktreeName?: string
  /**
   * Secondary repos of a multi-repo task, in pick order. The primary stays in
   * `repo`/`branch`/`worktreePath`/`baseRef`; `taskRepos` is the derived view
   * of all of them. Only on a `kind: "task"` row that owns its worktree.
   */
  readonly extraRepos?: readonly TaskExtraRepo[]
  /**
   * What the worker claims it delivered (`update --report-*`). Separate
   * from {@link prStatus}, which the daemon polls from the forge: a worker can
   * report a PR that doesn't exist; only `prStatus.checkState` is observed.
   */
  readonly report?: TaskWorkerReport
  /**
   * Source machine, stamped by the client merging several daemons' lists
   * (`machines/hub.ts`), never by a daemon (it doesn't know the viewer's
   * alias). Absent when only the local daemon is connected, so a
   * single-machine `rove api list` payload carries no trace of machines.
   */
  readonly origin?: TaskOrigin
  /**
   * The repo across machines, derived by the serving daemon on the wire
   * (`rove-daemon/src/repo-id.ts`), never persisted: `host/owner/name`, else
   * `root:<sha>`; absent outside a repo.
   */
  readonly repoId?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Where a merged task came from. `machineId` is the local alias; `hostLabel`
 *  is what a row displays (the remote hostname, falling back to the alias). */
interface TaskOrigin {
  readonly machineId: string
  readonly hostLabel: string
  /** Machine unreachable; this is its last known state. Kept, not dropped: it's the only record of where the work is. */
  readonly stale?: boolean
}

/**
 * A persisted deletion marker. A concurrent writer that still holds the
 * deleted task dirty in memory must not write it back — the tombstone makes
 * the deletion visible to peers. Pruned after a TTL at save time.
 */
export interface TaskTombstone {
  readonly id: string
  /** ISO timestamp of the deletion — the TTL clock for pruning. */
  readonly at: string
}

/**
 * On-disk manifest at `~/.rove/tasks.json`. v1 (`sessionId`-only) and v2
 * (`tabs`) migrate on load by dropping the chat-tab / model / vendor /
 * permissionMode fields.
 */
export interface TaskIndex {
  readonly version: 3
  readonly tasks: readonly Task[]
  /**
   * Deletion tombstones, absent when empty. Older builds ignore and drop it,
   * degrading to last-write-wins; `version` stays 3 because older readers
   * treat an unknown version as an empty index.
   */
  readonly removed?: readonly TaskTombstone[]
}

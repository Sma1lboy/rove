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
  TaskLinkedWorkItem,
  TaskPRStatus,
  TaskQuotaResumeState,
  TaskStatus,
  TaskWorkerReport,
} from "@sma1lboy/kobe-daemon/daemon/contracts"
import type { ObservedLanguage } from "@sma1lboy/kobe-daemon/prompts/observed-language"
import type { VendorId } from "./vendor.ts"

export type {
  TaskDeletionState,
  TaskDispatcher,
  TaskLinkedWorkItem,
  TaskPRStatus,
  TaskQuotaResumeState,
  TaskStatus,
  TaskWorkerReport,
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
   * `~/.rove/worktrees/<repo-key>/<slug>/` (older records: `.kobe/worktrees`,
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
   * Engine protocol: which history reader parses this task's transcript.
   * Absent normalizes to {@link DEFAULT_TASK_VENDOR}. Derived from
   * {@link command}'s argv[0] (`engine/engine-presets.ts`); an unnameable
   * command records the generic protocol until a live session is sniffed.
   * Records without `command` carry a preset id here and launch from it.
   */
  readonly vendor?: VendorId
  /**
   * Raw launch command as given to `add --command` / `set-command`: a preset
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
  /** ULID shared by all siblings of one `kobe api fan-out` call; single tasks never get one. */
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
  /** The kobe session (task + tab) that dispatched this task, when one did. */
  readonly dispatcher?: TaskDispatcher
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
   * What the worker claims it delivered (`set-status --report-*`). Separate
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

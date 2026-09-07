/**
 * Task data model (v0.6).
 *
 * Tasks persist Worktree and lifecycle metadata. Terminal-tab state and live
 * Hosted PTY sessions have their own owners; engine conversation ids remain
 * engine-owned on disk.
 *
 * On-disk manifest moves to v3 (see `TaskIndex` below). The store
 * migrates v1/v2 records on load by stripping the dropped fields;
 * downgrading is not supported.
 */

declare const TaskIdBrand: unique symbol
export type TaskId = string & { readonly [TaskIdBrand]: never }

/**
 * Cast a string to a {@link TaskId}. Caller asserts the value is a ULID.
 * No runtime validation — keep validators in the orchestrator layer.
 */
export const toTaskId = (id: string): TaskId => id as TaskId

export type { VendorId } from "./vendor.ts"
import type { ObservedLanguage } from "@sma1lboy/kobe-daemon/prompts/observed-language"
import type { VendorId } from "./vendor.ts"

/**
 * Default engine vendor when a task doesn't record one. Centralised so
 * a future "make codex the default" decision is a one-line change.
 */
export const DEFAULT_TASK_VENDOR: VendorId = "claude"

/**
 * Lifecycle states used by sidebar grouping and automation.
 */
export type TaskStatus = "backlog" | "in_progress" | "in_review" | "done" | "canceled" | "error"

/**
 * The runtime list of every {@link TaskStatus} — the single source of truth a
 * wire-boundary validator checks against, so an inbound `status` string is
 * confirmed with `isTaskStatus(x)` instead of a hand-maintained `!==` chain
 * that silently drifts when a status is added. The `satisfies` clause makes the
 * compiler reject this list if it ever falls out of sync with the union.
 */
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

type PRProviderId = "github" | "gitlab" | "bitbucket" | "unknown"
export type PRCheckState = "none" | "pending" | "passing" | "failing" | "unknown"
export type PRLifecycleState = "creating" | "open" | "ready_to_merge" | "merged" | "closed" | "unknown"

/**
 * PR status persisted on Task. The monitor displays it; the orchestrator
 * does NOT drive PR creation itself — create-PR flows ask the active engine
 * through Hosted PTY delivery.
 */
export interface TaskPRStatus {
  readonly provider: PRProviderId
  readonly lifecycle: PRLifecycleState
  readonly checkState: PRCheckState
  readonly number?: number
  readonly url?: string
  readonly title?: string
  readonly baseRef?: string
  readonly reviewDecision?: string
  readonly mergeable?: string
  readonly lastCheckedAt?: string
  readonly lastError?: string
}

export type TaskDeletionPhase = "queued" | "running" | "error"

/** Durable state for daemon-owned background worktree cleanup. */
export interface TaskDeletionState {
  readonly phase: TaskDeletionPhase
  readonly force: boolean
  /** Opt-in: also delete the task's git branch. Default (absent/false) keeps
   *  the branch — git history is the durable record, the task row is not. */
  readonly deleteBranch?: boolean
  readonly requestedAt: string
  readonly error?: string
}

/**
 * Durable schedule for the daemon's rate-limit auto-resume: the engine hit
 * its subscription quota and the provider reported when the window resets.
 * The daemon's quota-resume runner delivers a continue prompt into the
 * task's live engine session once `resumeAt` passes, then clears this.
 */
export interface TaskQuotaResumeState {
  /** ISO-8601 time the provider's exhausted window resets. */
  readonly resumeAt: string
  /** ISO-8601 time the rate limit was observed and this schedule written. */
  readonly requestedAt: string
}

/**
 * Provenance of the kobe session that created this task: which task and
 * which terminal tab dispatched it (from the creating CLI process's
 * `$KOBE_TASK_ID` / `$KOBE_TAB_ID`). This is the reply address for the
 * collaboration loop — a sub-task's bare `send` routes its outcome back to
 * this exact tab. Absent when the task was created outside a kobe session
 * (TUI dialog, plain shell) and on records that predate the field.
 */
export interface TaskDispatcher {
  readonly taskId: string
  readonly tabId: string
}

/** Back-pointer from a routine's standing session task to its schedule. */
export interface TaskRoutineLink {
  /** `Automation.id`. Survives the routine being renamed or rescheduled. */
  readonly automationId: string
}

/**
 * One task. Stored in `~/.rove/tasks.json` as part of {@link TaskIndex}.
 *
 * Field invariants:
 * - `id` is a ULID (lexicographically sortable, time-prefixed).
 * - `repo` is an absolute path to the source repo's working tree
 *   (NOT the per-task worktree — that's `worktreePath`).
 * - `worktreePath` is an absolute path; may not yet exist if the
 *   task is still in `backlog`. For `kind: "main"` it equals `repo`.
 * - `vendor` is a hint for the monitor's history reader; missing
 *   records normalise to `DEFAULT_TASK_VENDOR`.
 * - `createdAt` / `updatedAt` are ISO-8601 strings (UTC).
 */
export interface Task {
  readonly id: TaskId
  readonly title: string
  readonly repo: string
  readonly branch: string
  readonly worktreePath: string
  /**
   * `"main"` tasks are pinned to a saved repo's root checkout (no
   * `git worktree add`); they set `worktreePath === repo` and
   * `branch === ""`. Regular `"task"` tasks live in a per-task
   * worktree under `~/.rove/worktrees/<repo-key>/<slug>/` (or global/repo-local
   * `.kobe/worktrees` / legacy `.claude/worktrees` for older records).
   * `"dir"` tasks (`rove .`) pin an arbitrary existing directory the
   * user opened directly: `worktreePath === repo`, `branch === ""`, no
   * project association, and deletion only drops the index entry — the
   * directory itself is never removed.
   * Optional on disk: records without it normalize to `"task"` at load time.
   */
  readonly kind?: "main" | "task" | "dir"
  /**
   * A SCRATCH shell task: a `kind: "dir"` task whose cwd is not
   * settled yet — an ad-hoc shell opened to poke around, living in the
   * sidebar's Scratch section instead of a project group. Zero-ceremony
   * lifecycle: its shell exiting deletes the row outright. The flag CLEARS
   * when the task earns a place — the user renames it (`setTitle`) or its
   * live cwd + a detected harness migrate it into a project
   * (`adoptScratchRepo`) — after which it is an ordinary directory task.
   */
  readonly scratch?: boolean
  /**
   * The routine (`Automation`) this task is the standing session for.
   * A routine with `persistentSession` creates ONE task and
   * re-delivers into it on every firing, instead of a fresh worktree per
   * run — so a daily check can read what it said yesterday.
   *
   * The sidebar renders these behind a per-project count row rather than as
   * loose task rows: 7 daily routines are 49 rows a week of background noise
   * competing with the handful of tasks the user opened themselves. The task
   * is ordinary in every other layer — selectable, Inbox-reachable, and
   * addressable by `rove api` — only its resting sidebar row is folded away.
   *
   * Absent on tasks created before the field, which is what keeps the
   * already-created routine tasks rendering exactly as they do today.
   */
  readonly routine?: TaskRoutineLink
  readonly status: TaskStatus
  /**
   * User-pinned regular tasks float to the top of the sidebar's
   * task list. Defaults to `false` at load time.
   */
  readonly pinned?: boolean
  /**
   * Engine PROTOCOL hint — tells the monitor's history reader which
   * adapter to use when parsing this task's transcript. Optional;
   * missing values normalize to {@link DEFAULT_TASK_VENDOR}.
   *
   * Derived from {@link command}, not declared beside it: `rove api add
   * --command …` resolves the protocol from the command's argv[0]
   * (`engine/engine-presets.ts`), and a command kobe cannot name records
   * the generic protocol until a live session is sniffed. Records that
   * predate `command` carry a preset id here and launch from it, so the
   * two fields stay interchangeable at the launch site.
   */
  readonly vendor?: VendorId
  /**
   * The RAW launch command for this task's engine — what the dispatch
   * face (`add --command` / `set-command`) was given, verbatim. Either a
   * registered preset id (built-in or custom, whose `engineCommand.<id>`
   * override still applies) or a full command line. Absent on records
   * created before the field, which launch from {@link vendor} instead.
   */
  readonly command?: string
  readonly prStatus?: TaskPRStatus
  /**
   * Reasoning/effort level for the task's engine, when the vendor supports
   * one (codex: `none`/`low`/`medium`/`high`/`xhigh`/`max`). Optional + additive:
   * missing records load unchanged, and a vendor with no effort levels
   * (claude today) leaves it undefined. The launch path maps it to the
   * vendor-correct flag (see `interactive-command.ts`).
   */
  readonly modelEffort?: string
  /**
   * Fan-out round marker: every sibling created by one `kobe api fan-out`
   * call shares a ULID, so the round survives the CLI call that created it
   * (grouping, aggregate notifications, round-level operations). Optional +
   * additive: single tasks never get one.
   */
  readonly groupId?: string
  /**
   * The language this task's user writes in, observed from their own prompts
   * (`prompts/observed-language.ts`) — NOT a setting. Text Rove injects into
   * the session at moments when no user message is in hand (a quota resume
   * fired by a timer, the Create-PR prompt behind a keypress) reads this so
   * it comes out in the language the person is actually using.
   *
   * Absent until the first prompt with an opinion in it; absent means
   * English, which is what every record predating the field loads as.
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
   * The task brief: the full text of the prompt `add --prompt` delivered
   * into this task's engine, recorded on the delivery path. The engine's
   * own transcript is NOT durable — without this a dead engine takes the
   * brief down with it, and the only recovery is the user re-pasting it. Stored
   * verbatim (never truncated: the constraints an agent needs most often
   * sit at the END of a long brief). Optional + additive: tasks created
   * without a prompt never get one.
   */
  readonly prompt?: string
  /**
   * The base ref the task branch was cut from (`add --base-branch`),
   * persisted so `collect`'s branch signals (ahead count / diffstat)
   * compare against the REAL fork point instead of re-guessing
   * `origin/HEAD` → `main` → `master`, and a daemon restart between
   * create and lazy worktree materialise cannot silently drop it.
   * Optional + additive: records predating the field fall back to the
   * guess.
   */
  readonly baseRef?: string
  /**
   * The directory name this task's worktree will take under the repo's
   * worktree root (`add --worktree-name`), instead of a name picked from the
   * animal pool. Persisted because allocation is LAZY: the pick happens on
   * first enter, possibly in a later daemon process than the create.
   * Absent = the usual generated name.
   */
  readonly worktreeName?: string
  /**
   * What the WORKER said it delivered (`set-status --report-*`).
   *
   * Deliberately separate from {@link prStatus}, which the daemon polls from
   * the forge: this is a claim, that is an observation, and a dispatcher
   * deciding whether to land needs to know which one it is reading. A worker
   * can write `report.pr = 921` for a PR that does not exist; only
   * `prStatus.checkState` comes from asking GitHub.
   */
  readonly report?: TaskWorkerReport
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * A worker's own account of what it produced, stamped by
 * `set-status --report-branch/--report-pr/--report-summary`.
 *
 * The gap it closes: outcomes travelled as PROSE in a `send` back to the
 * dispatcher, which then parsed `succeeded: … (branch fix/x)` by convention.
 * A worker that phrased it differently was silently unparseable, and nothing
 * in the task row said what had been delivered. Every field is optional —
 * a report naming only a summary is still a report.
 */
export interface TaskWorkerReport {
  /** The branch the worker says holds the work. */
  readonly branch?: string
  /** The PR number the worker says it opened. NOT the same fact as
   *  `prStatus.number`, which the daemon read from the forge. */
  readonly pr?: number
  /** One line of what was delivered. */
  readonly summary?: string
  /** When the report was written (ISO 8601). */
  readonly at: string
}

/**
 * A pointer back to the issue in someone else's tracker that this task exists
 * to address. Stamped once at creation and never synced: the fields are a
 * SNAPSHOT for display, and `url` is the durable way back to the live item.
 * kobe deliberately does not mirror the item's state (see `work-items.ts`).
 */
export interface TaskLinkedWorkItem {
  readonly provider: "github"
  readonly type: "issue" | "pr"
  readonly number: number
  /** Title as it read when the task was started. */
  readonly title: string
  readonly url: string
}

/**
 * On-disk manifest at `~/.rove/tasks.json`.
 *
 * Version 3 = the v0.6 reshape. v1 (`sessionId`-only) and v2 (`tabs`)
 * manifests are migrated on load by dropping the chat-tab / model /
 * vendor / permissionMode fields. Downgrading is not supported.
 */
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

export interface TaskIndex {
  readonly version: 3
  readonly tasks: readonly Task[]
  /**
   * Deletion tombstones. Optional and absent when empty: builds that predate
   * the field ignore it on read and drop it on write, degrading to plain
   * last-write-wins without corrupting anything (which is also why
   * `version` stays 3 — older readers treat an unknown version as an empty
   * index, losing everything).
   */
  readonly removed?: readonly TaskTombstone[]
}

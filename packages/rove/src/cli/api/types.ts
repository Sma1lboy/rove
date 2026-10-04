/**
 * `kobe api` contract types — flag specs, verbs, and the side-effect seams
 * (`ApiRuntime`, `PromptDeliveryOps`) — importable without the dispatcher.
 */

import type { VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import type { VerbArgs } from "./flags.ts"
import type { RestoredTabRef } from "./tab-respawn.ts"
import type { TaskTabRow } from "./tab-snapshot.ts"

export type Flags = Map<string, string>

export interface ParsedArgs {
  readonly flags: Flags
  readonly pretty: boolean
  readonly help: boolean
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** Extra context merged into the error JSON — e.g. `taskId` when create
     *  succeeded but delivery failed, so a script keeps the engine-burning task.
     *  Rejection sites SHOULD include `hint` (one sentence: what next) and
     *  `nextCommandArgs` (argv without the executable, runnable verbatim, e.g.
     *  `["api", "schema"]`). Additive: envelope stays `{error:{message,code,...}}`. */
    readonly data?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/**
 * Daemon refusal codes (`DIRTY_WORKTREE`, `LAND_CONFLICT`, `MISSING_REF`, …)
 * ride the MESSAGE as a `CODE: ` prefix; an error's `name` doesn't survive RPC.
 */
const DAEMON_CODE_PREFIX = /^([A-Z][A-Z0-9_]{2,}): /

/**
 * Split `CODE: rest`, or `null` for an uncoded message. The one prefix reader.
 * Callers drop the prefix from the emitted message: it is the `code` field, and
 * printing it twice invites callers to keep parsing prose.
 */
export function splitDaemonCode(message: string): { code: string; rest: string } | null {
  const match = DAEMON_CODE_PREFIX.exec(message)
  if (!match?.[1]) return null
  return { code: match[1], rest: message.slice(match[0].length) }
}

/** The `hint` + `nextCommandArgs` pair pointing an agent at a verb's own `--help`. */
export function helpStep(verbName: string): Record<string, unknown> {
  return {
    hint: `run the verb's --help for its exact flag contract, then retry`,
    nextCommandArgs: ["api", verbName, "--help"],
  }
}

// ── Declarative verb + flag specs (single source of truth) ───────────────────

/** `int` is POSITIVE; `uint` also admits zero, for flags where zero means
 *  something (`--grace` on the routine verbs). */
type FlagType = "string" | "int" | "uint" | "bool" | "enum" | "csv"

export interface FlagSpec {
  readonly name: string
  readonly type: FlagType
  readonly required?: boolean
  readonly description: string
  /** Allowed values when `type === "enum"`. */
  readonly values?: readonly string[]
  /** Default shown in schema/help (informational; not auto-applied). */
  readonly default?: string
  /** Metavar for help/schema, e.g. PATH / ID / TEXT. */
  readonly placeholder?: string
}

/** What a verb handler runs against; all injectable so handlers test without a daemon or PTY host. */
export interface VerbContext {
  /** Spec-typed flag access — coercion + requiredness derived from the verb's own {@link FlagSpec}s. */
  readonly args: VerbArgs
  /** Daemon RPC surface; `null` only for `offline` verbs (guard with `daemonOf`). */
  readonly client: DaemonRpc | null
  /** Side-effect seam (hosted sessions / git) — swapped for a fake in unit tests. */
  readonly runtime: ApiRuntime
}

type VerbHandler = (ctx: VerbContext) => Promise<unknown>

/**
 * `rove api schema` groups. Closed and REQUIRED on {@link VerbSpec}, so a new
 * verb won't compile ungrouped; `VERB_GROUPS` derives from the specs. No
 * `other` fallback: it would report a group `--group` rejects as unknown.
 */
export const VERB_GROUP_IDS = [
  "discover",
  "read",
  "create",
  "drive",
  "edit",
  "issues",
  "workitems",
  "routine",
  "lifecycle",
  "worktree",
  "feedback",
] as const

export type VerbGroup = (typeof VERB_GROUP_IDS)[number]

export interface VerbSpec {
  readonly name: string
  /** Which `rove api schema --group G` listing this verb appears under. */
  readonly group: VerbGroup
  readonly summary: string
  readonly flags: readonly FlagSpec[]
  /** Verbs that don't need the daemon (e.g. `schema`). */
  readonly offline?: boolean
  readonly handler: VerbHandler
}

// ── Prompt delivery (shared by add / send) ───────────────────────────────────

export interface PromptTarget {
  readonly id: string
  readonly worktreePath: string
  readonly kind?: "main" | "task" | "dir"
  /** Resolved PROTOCOL (history reader / trust store / delivery mode). */
  readonly vendor?: VendorId
  /** Raw launch command pinned on the task; wins over {@link vendor} at spawn. */
  readonly command?: string
  readonly modelEffort?: string
  readonly model?: string
  readonly repo?: string
  /**
   * `send --tab`: `"new"` spawns an engine in the next tab-N; `"tab-N"` targets
   * that exact alive tab (TAB_NOT_FOUND otherwise). Undefined = canonical tab.
   */
  readonly tab?: string
  /**
   * Engine PROTOCOL pinned on a `--tab new` tab, recorded like the TUI's ctrl+e
   * pick so it survives restarts and a later task `set-command`.
   */
  readonly tabVendor?: VendorId
  /** Raw launch command for a `--tab new` tab — the command half of {@link tabVendor}. */
  readonly tabCommand?: string
  /**
   * FIRST prompt of a just-created task (`add --prompt`, single or `--count`):
   * gets the branch-rename coda (`PromptDeliveryIntent`'s `new-task`). `send`
   * never sets it.
   */
  readonly newTask?: boolean
  /**
   * Consent to REVIVE a freeze-restored `--tab tab-N` (`send --respawn`);
   * otherwise `TAB_RESTORED`. Respawn re-runs the recorded launch, which for a
   * tab without a pinned conversation id still carries the task's original
   * first prompt — so it is never inferred.
   */
  readonly respawn?: boolean
}

export interface DeliveredPrompt {
  readonly session: string
  readonly pane: string
  /** A NEW session was created by this call (never "delivered into one"). */
  readonly started: boolean
  /**
   * The engine's tty was in raw mode and READING when we wrote — observed via
   * DECSET 2004 in the session ring, not the process table. A write while this
   * is false is silently truncated to the tty's 1024-byte canonical buffer.
   * Independent of {@link delivered}, never a copy of it.
   */
  readonly engineReady: boolean
  /**
   * Written to the pty AFTER confirmed reading (observed, never hardcoded).
   * Byte-level truth only; UI-level is {@link promptEcho} — an engine may
   * accept a prompt while showing just a `[Pasted text #1]` placeholder.
   */
  readonly delivered: boolean
  /**
   * Bytes handed to the pty (incl. bracketed-paste wrapper). Present whenever a
   * write was attempted; pairs with the daemon's `pty` log line.
   */
  readonly bytes?: number
  /**
   * Whether the prompt's tail was seen echoed on capture. `"unconfirmed"` is
   * INCONCLUSIVE, not failure: placeholder-collapsing engines never echo big
   * pastes. Absent when no write was attempted.
   */
  readonly promptEcho?: "confirmed" | "unconfirmed"
  /**
   * Freeze-restored (dead) engine tabs this call did NOT deliver into. Only
   * with `started: true`, where a fresh task's first start and "your real
   * conversations are frozen, so I opened a blank one" otherwise look
   * identical (and `get-task` says `running: true`). Each entry carries the
   * tab id and the conversation id to resume.
   */
  readonly frozenTabs?: readonly RestoredTabRef[]
  /**
   * RESPAWNED a freeze-restored tab before writing (`send --tab tab-N
   * --respawn`). Unlike {@link started}: the SAME tab, scrollback kept, pinned
   * conversation resumed when there is one.
   */
  readonly respawned?: true
  /**
   * The session's own last line (shell `no such file or directory`, or the
   * wrapper's `Engine exited (code N)`) when a fresh spawn produced no engine.
   * Only with `engineReady: false` on a `started` launch, so a fan-out sees
   * WHICH launch failed.
   *
   * With `delivered: true` it is the one non-failure: a repo-init script is
   * still running and the prompt rides the not-yet-executed launch argv.
   */
  readonly reason?: string
}

/** Hosted prompt delivery seam, injectable for handler/unit tests. */
export interface PromptDeliveryOps {
  deliverHosted(target: PromptTarget, worktree: string, prompt: string): Promise<DeliveredPrompt>
}

/**
 * A tab row plus its pinned conversation id (`TerminalTab.sessionId`) — the
 * uuid `claude --resume` / `codex resume` needs to recover a dead tab. The join
 * happens in `runtime.ts`; `joinTaskTabs` would be the tidier home.
 */
type TaskTabRowWithSession = TaskTabRow & { readonly sessionId?: string }

// ── Runtime (the side-effect seam handlers run against) ─────────────────────

/**
 * Everything a handler touches besides daemon RPC (session liveness, prompt
 * delivery, git reads). Real implementation in `runtime.ts`; tests swap fakes.
 */
export interface ApiRuntime {
  /** {@link taskTabs}'s `.running`, for callers that need nothing else. */
  isTaskRunning(taskId: string, engineArgv?: readonly string[]): Promise<boolean | null>
  /**
   * Persisted terminal tabs joined with session liveness, plus `.running`,
   * from one host round-trip.
   *
   * `running` is TRI-STATE: `null` means the pty host could not be asked —
   * "couldn't look", not "nothing running" (as `pty-list`'s `sessions: null`),
   * which a cleanup loop must know before deleting a worktree.
   *
   * Pass `engineArgv` (`engineLaunchArgv({command, vendor})`): without it a
   * custom wrapper engine reads as "no engine" and the task as stopped.
   */
  taskTabs(
    taskId: string,
    engineArgv?: readonly string[],
  ): Promise<{ tabs: readonly TaskTabRowWithSession[]; running: boolean | null }>
  /**
   * Task ids with a LIVE session, from one fleet-wide `pty.list` (not one
   * round-trip per task). `null` = no pty host to ask, never "nothing running".
   */
  liveTaskIds(): Promise<ReadonlySet<string> | null>
  /** Close one exact Terminal Tab without a mounted TUI. */
  closeTerminalTab(taskId: string, tabId: string): Promise<{ kind: TaskTabRow["kind"]; wasAlive: boolean }>
  /** Deliver a prompt into a task's engine pane (building the session if needed). */
  deliverPrompt(client: DaemonRpc, target: PromptTarget, prompt: string): Promise<DeliveredPrompt>
  /** Canonical source repo for task creation and grouping. */
  resolveRepoRoot(absPath: string): Promise<string>
  /** Can a worktree be cut from this repo? On the seam so handler tests need no
   *  real repo. Remote (`ssh://…`) keys answer true; remote-add validates them. */
  isUsableRepo(absPath: string): Promise<boolean>
  /** `git check-ref-format` verdict, on the seam so handler tests don't spawn git. */
  isValidBranchName(branch: string): Promise<boolean>
  /** Preferred engine for new tasks in `repo`; undefined delegates to daemon defaults. */
  defaultVendor(repo?: string): Promise<VendorId | undefined>
  /** Uncommitted +/− counts; `null` when git could not be read at all. NOT
   *  `{0,0}`: a fabricated zero reads as "safe to land / safe to delete".
   *  Same all-null contract as `readBranchSignals`. */
  readWorktreeChanges(worktreePath: string): Promise<{ added: number; deleted: number } | null>
  /** Committed work vs the branch's base: ahead/behind counts + diffstat (`collect`).
   *  `recordedBaseRef` is the task's persisted fork point (`add --base-branch`);
   *  when present it wins over the base guess; absent/unresolvable falls back. */
  readBranchSignals(
    worktreePath: string,
    recordedBaseRef?: string,
  ): Promise<{
    baseRef: string | null
    ahead: number | null
    behind: number | null
    diff: { files: number; insertions: number; deletions: number } | null
  }>
  /**
   * Stop a task's hosted sessions, only after `task.delete` succeeded. Never
   * throws: teardown must not fail the already-committed RPC.
   */
  tearDownSession(taskId: string): Promise<void>
}

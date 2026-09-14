/**
 * Shared types for `kobe api` — flag specs, the verb contract, and the
 * side-effect seams (`ApiRuntime`, `PromptDeliveryOps`) handlers run
 * against. Split out of `api-cmd.ts` (see that file's header) so each verb
 * module can depend on the contract without pulling in the dispatcher.
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
    /** Extra context merged into the error JSON — e.g. `taskId` when a
     *  create succeeded but delivery failed, so a script doesn't lose the
     *  already-created (engine-burning) task.
     *
     *  Self-healing convention: rejection sites SHOULD include
     *  - `hint` — one sentence telling the agent what to do next, and
     *  - `nextCommandArgs` — argv for the same `kobe` executable (no
     *    executable name) the agent can run verbatim to recover, e.g.
     *    `["api", "schema"]` or `["daemon", "status"]`.
     *  Both are additive: the envelope stays `{error:{message,code,...}}`. */
    readonly data?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/**
 * A daemon refusal's machine code, as the orchestrator writes it: every
 * sentinel in `orchestrator/errors.ts` (`DIRTY_WORKTREE`, `LAND_CONFLICT`,
 * `MISSING_REF`, …) rides the MESSAGE as a `CODE: ` prefix, because an
 * error's `name` does not survive the RPC wire.
 */
const DAEMON_CODE_PREFIX = /^([A-Z][A-Z0-9_]{2,}): /

/**
 * Split `CODE: rest` into its parts, or report `null` for an uncoded message.
 *
 * One reader for the prefix, shared by the generic boundary (`toApiError`,
 * which lifts the code for EVERY daemon error) and the handful of verbs that
 * additionally attach an executable recovery to a code they know. Both drop
 * the prefix from the message they emit: it is the `code` field now, and
 * printing it twice invites a caller to keep parsing prose.
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

/** `int` is a POSITIVE integer (the common case: counts, limits, ids).
 *  `uint` also admits zero, for a flag whose zero means something rather
 *  than "unset" — see `--grace` on the routine verbs. */
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

/**
 * What a verb handler runs against. Everything here is injectable so a
 * handler's LOGIC is unit-testable without a daemon or PTY Host socket:
 * `client` accepts any {@link DaemonRpc} (tests pass a fake that
 * records requests), `runtime` carries the side-effecting operations
 * (hosted-session liveness, prompt delivery, git worktree reads).
 */
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
 * The taxonomy `rove api schema` exposes for LEVELED exploration. Closed on
 * purpose: a verb's group is a REQUIRED field on {@link VerbSpec}, so a new
 * verb does not compile until it is grouped, and `VERB_GROUPS` is derived from
 * the specs instead of being hand-maintained beside them. There is
 * deliberately no `other`: such a fallback lets an ungrouped verb report a
 * group name that `--group` then rejects as unknown — invisible until an
 * agent actually browses by group.
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
  readonly repo?: string
  /**
   * Tab addressing (`send --tab`): `"new"` mints the next tab-N and spawns
   * a fresh engine tab there; `"tab-N"` delivers to that exact alive tab
   * (TAB_NOT_FOUND when dead/absent). Undefined = canonical engine tab.
   */
  readonly tab?: string
  /**
   * Engine PROTOCOL to pin on a `--tab new` tab, when the tab should not
   * simply inherit the task's. Recorded on the minted tab exactly like the
   * TUI's ctrl+e pick, so the tab keeps that engine across restarts and a
   * later `set-command` on the task does not silently move it.
   */
  readonly tabVendor?: VendorId
  /**
   * Raw launch command to pin on a `--tab new` tab (`send --tab new
   * --command …`) — the command half of {@link tabVendor}. Lets one
   * worktree run two different agents without changing the task's own.
   */
  readonly tabCommand?: string
  /**
   * This delivery is the FIRST prompt of a task the caller just created
   * (`add --prompt`, single or `--count`) — it gets the branch-rename coda (see
   * `PromptDeliveryIntent`'s `new-task` kind). `send` never sets it.
   */
  readonly newTask?: boolean
  /**
   * Consent to REVIVE a freeze-restored `--tab tab-N` (`send --respawn`).
   * Without it an addressed tab a pty-host restart froze stays a typed
   * refusal (`TAB_RESTORED`): respawning re-runs the tab's recorded launch,
   * and for a tab with no pinned conversation id that command still carries
   * the task's original first prompt. Never inferred — a caller asks.
   */
  readonly respawn?: boolean
}

export interface DeliveredPrompt {
  readonly session: string
  readonly pane: string
  /** A NEW session was created by this call (never "delivered into one"). */
  readonly started: boolean
  /**
   * The engine had its tty in raw mode and was READING when we wrote —
   * observed via DECSET 2004 in the session ring, not inferred from the
   * process table. This is the field that decides whether a large prompt
   * can survive: a write made while this is false is silently truncated to
   * the tty's 1024-byte canonical buffer.
   *
   * Never a copy of {@link delivered} — that would be a second voice
   * repeating one guess rather than an independent signal.
   */
  readonly engineReady: boolean
  /**
   * The prompt was written to the engine's pty AFTER it was confirmed
   * reading. A real observation, never a hardcoded `true`.
   *
   * It does NOT promise the engine's composer rendered the text; that is
   * {@link promptEcho}. Delivery is byte-level truth, echo is UI-level
   * truth, and they are reported separately because an engine may accept a
   * prompt perfectly while showing only a `[Pasted text #1]` placeholder.
   */
  readonly delivered: boolean
  /**
   * Bytes handed to the pty for this prompt (including the bracketed-paste
   * wrapper when one was used). Present whenever a write was attempted;
   * pairs with the daemon's `pty` log line for after-the-fact auditing.
   */
  readonly bytes?: number
  /**
   * Whether the prompt's tail was seen echoed back on capture — the capture
   * confirmation that {@link delivered} deliberately does not make.
   *
   * `"confirmed"` is positive proof. `"unconfirmed"` is INCONCLUSIVE, not
   * failure: engines that collapse a big paste into a placeholder never echo
   * the text. Absent when no write was attempted.
   */
  readonly promptEcho?: "confirmed" | "unconfirmed"
  /**
   * Freeze-restored (thawed, dead) engine tabs on this task that this call
   * did NOT deliver into — the conversations a pty-host restart froze.
   *
   * Present only when a NEW session was started (`started: true`), which is
   * the branch where the two outcomes are indistinguishable otherwise: a
   * first start of a fresh task and "your two real conversations are frozen,
   * so I opened a blank one" both report `started/engineReady/delivered:
   * true`, and `get-task` then says `running: true` because the blank tab is
   * alive. Each entry carries the tab id to address and the conversation id
   * to resume it with, so the caller can act instead of guessing.
   */
  readonly frozenTabs?: readonly RestoredTabRef[]
  /**
   * This delivery RESPAWNED a freeze-restored tab before writing into it
   * (`send --tab tab-N --respawn`). Distinct from {@link started}, which
   * means a new session: a respawn reopens the SAME tab, keeping its
   * scrollback, and resumes its pinned conversation when it has one.
   */
  readonly respawned?: true
  /**
   * Why nothing was confirmed — the session's own last line (its shell's
   * `no such file or directory`, or the wrapper's `Engine exited (code N)`
   * banner) when a fresh spawn produced no engine process. Present only
   * alongside `engineReady: false` on a launch that reported `started`, so a
   * fan-out sees WHICH launch failed instead of N uniform green results.
   *
   * `engineReady: false` with `delivered: true` is the one non-failure it
   * describes: a repo-init script is still running, so the engine has not
   * started yet and the prompt is still riding its unexecuted launch argv.
   */
  readonly reason?: string
}

/** Hosted prompt delivery seam, injectable for handler/unit tests. */
export interface PromptDeliveryOps {
  deliverHosted(target: PromptTarget, worktree: string, prompt: string): Promise<DeliveredPrompt>
}

/**
 * A tab row plus the conversation id pinned on it (`TerminalTab.sessionId`)
 * — the exact uuid `claude --resume` / `codex resume` needs. Rove has always
 * persisted it per engine tab and exposed it on no read surface, so the
 * documented recovery for a dead tab was to hunt for the id in the engine's
 * own picker while it sat one field away in `state.json`.
 *
 * Declared here rather than on `TaskTabRow` itself only because the join
 * happens in `runtime.ts`, where the snapshot is already in hand; folding
 * the field into `joinTaskTabs` is the tidier home for it.
 */
export type TaskTabRowWithSession = TaskTabRow & { readonly sessionId?: string }

// ── Runtime (the side-effect seam handlers run against) ─────────────────────

/**
 * Everything a verb handler touches besides daemon RPC: hosted-session
 * liveness, prompt delivery, and git worktree reads. The default implementation
 * (in `runtime.ts`) is the real thing (lazy-importing the heavier modules);
 * unit tests swap in fakes so handler logic runs without a daemon, PTY host, or
 * git.
 */
export interface ApiRuntime {
  /** {@link taskTabs}'s `.running`, for callers that need nothing else. */
  isTaskRunning(taskId: string, engineArgv?: readonly string[]): Promise<boolean | null>
  /**
   * The task's persisted terminal tabs joined with hosted-session liveness,
   * plus the derived `.running` — the same answer {@link isTaskRunning}
   * gives, from the same read (`get-task` needs both, one host round-trip).
   *
   * `running` is TRI-STATE. `true`/`false` are verdicts about engine
   * processes; `null` means the pty host could not be asked, which is
   * "couldn't look" and not "nothing is running" — the distinction
   * `pty-list` already publishes as `sessions: null`, and the one an
   * unattended cleanup loop needs before it deletes a worktree.
   *
   * `engineArgv` is the task's own launch command. Without it a custom
   * engine — a wrapper script no vendor table names — walks as "no engine"
   * and its task reads stopped while it works; callers holding the task
   * should pass `engineLaunchArgv({command, vendor})`.
   */
  taskTabs(
    taskId: string,
    engineArgv?: readonly string[],
  ): Promise<{ tabs: readonly TaskTabRowWithSession[]; running: boolean | null }>
  /** Close one exact Terminal Tab without a mounted TUI. */
  closeTerminalTab(taskId: string, tabId: string): Promise<{ kind: TaskTabRow["kind"]; wasAlive: boolean }>
  /** Deliver a prompt into a task's engine pane (building the session if needed). */
  deliverPrompt(client: DaemonRpc, target: PromptTarget, prompt: string): Promise<DeliveredPrompt>
  /** Canonical source repo for task creation and grouping. */
  resolveRepoRoot(absPath: string): Promise<string>
  /** Is this resolved repo something a worktree can be cut from? On the seam
   *  beside {@link resolveRepoRoot} because it asks about the same path at the
   *  same boundary — and because a direct `git` shell-out here would make every
   *  handler test need a real repo on disk. Remote (`ssh://…`) keys answer true:
   *  the remote-add flow validates those. */
  isUsableRepo(absPath: string): Promise<boolean>
  /** Would git accept this as a branch name? On the same seam and for the
   *  same reason as {@link isUsableRepo}: the answer comes from `git
   *  check-ref-format`, and handler tests must not have to spawn git. */
  isValidBranchName(branch: string): Promise<boolean>
  /** Preferred engine for new tasks in `repo`; undefined delegates to daemon defaults. */
  defaultVendor(repo?: string): Promise<VendorId | undefined>
  /** Uncommitted +/− counts for a worktree; `null` when git could not be
   *  read at all (unreadable admin dir, git off PATH, worktree gone). NOT
   *  `{0,0}` — that is the answer for a genuinely clean worktree, and
   *  `collect`'s own summary says non-zero means the attempt cannot land, so
   *  a fabricated zero reads as "safe to land / safe to delete". Mirrors the
   *  all-null contract `readBranchSignals` already keeps for `base`. */
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
   * Stop every hosted session for a task, mirroring the TUI's delete teardown.
   * Run only after the matching `task.delete` RPC succeeds. Best-effort: a
   * teardown failure must not fail the already-committed RPC, so it never
   * throws.
   */
  tearDownSession(taskId: string): Promise<void>
}

/**
 * Shared types for `kobe api` — flag specs, the verb contract, and the
 * side-effect seams (`ApiRuntime`, `PromptDeliveryOps`) handlers run
 * against. Split out of `api-cmd.ts` (see that file's header) so each verb
 * module can depend on the contract without pulling in the dispatcher.
 */

import type { VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import type { VerbArgs } from "./flags.ts"
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
   * Present when the delivery gate found the composer busy and the prompt was
   * accepted-but-deferred rather than dropped: the daemon
   * stored the text and queued a `prompt_deferred` inbox episode. This is a
   * SUCCESS outcome for the caller — the daemon now owns the message and will
   * hold it for a human to release from the Inbox. Callers MUST NOT retry a
   * deferred send: the tab's deferred slot stays occupied until release or
   * expiry, and a later send fails with `DEFERRED_PROMPT_PENDING`. Absent on
   * direct delivery and on genuine failure.
   */
  readonly deferred?: { readonly id: string; readonly layer: "recent-human-write" | "composer-not-empty" }
}

/** What the delivery layer calls to hand a blocked prompt to daemon ownership. */
export interface PromptDeferralSink {
  /**
   * Try to store the blocked prompt. Implementations perform the
   * `deferredPrompt.file` daemon RPC; tests inject a fake.
   */
  defer(info: {
    readonly taskId: string
    readonly tabId: string
    readonly prompt: string
    readonly layer: "recent-human-write" | "composer-not-empty"
  }): Promise<{ readonly kind: "filed"; readonly id: string } | { readonly kind: "occupied"; readonly id: string }>
}

/** Hosted prompt delivery seam, injectable for handler/unit tests. */
export interface PromptDeliveryOps {
  deliverHosted(
    target: PromptTarget,
    worktree: string,
    prompt: string,
    defer?: PromptDeferralSink,
  ): Promise<DeliveredPrompt>
}

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
  ): Promise<{ tabs: readonly TaskTabRow[]; running: boolean | null }>
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

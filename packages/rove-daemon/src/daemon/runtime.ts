import type { DaemonRpcClient } from "../client/rpc.ts"
import type {
  AgentTurn,
  DaemonOrchestrator,
  DaemonTask,
  EngineActivityKind,
  EngineContextUsage,
  EngineQuotaUsage,
  UpdateInfo,
  VendorId,
  WorktreeChanges,
} from "./contracts.ts"

export interface EngineTurnDetectorAdapter {
  latestActivity(worktreePath: string): Promise<{
    marker: { id: string; timestampMs: number } | null
    mtimeMs: number
  }>
  /** Session-scoped evidence. Null means unknown; never borrow another session's completion. */
  latestActivityInFile(transcriptPath: string): Promise<{
    marker: { id: string; timestampMs: number } | null
    mtimeMs: number
  } | null>
  supportsCompletionMarkers(): boolean
}

/** Cadence knobs + per-key state of the scheduling core; re-exported, not restated. */
export type { PollCadenceConfig, PollScheduleState } from "./poll-scheduling.ts"

export interface DaemonRuntimeAdapter {
  readonly currentVersion: string
  readonly defaultTaskVendor: VendorId
  readonly placeholderTaskTitle: string
  isTaskStatus(value: unknown): value is DaemonTask["status"]
  isEngineActivityKind(value: string): value is EngineActivityKind
  /** True for kinds that change the activity badge state; false for
   *  lifecycle-only kinds (tool/compact/subagent) that only feed plugins. */
  affectsActivityState(value: string): boolean
  /**
   * Foreground engine per session root pid from ONE `ps` snapshot: vendor and
   * the engine's own pid (what a death record names, distinct from the PTY
   * that outlived it), or null for "no engine in this tree".
   */
  foregroundEngines(pids: readonly number[]): Promise<ReadonlyMap<number, { vendor: VendorId; pid: number } | null>>
  /**
   * Engine-owned verdict on a live OSC title: "working" while the vendor's
   * animated frame prefixes it, "rest" when a status-owning vendor wrote a
   * title without one, null when no vocabulary or empty title — never guessed.
   */
  titleTurnHint(vendor: VendorId, title: string): "working" | "rest" | null
  /**
   * From live engine-tab evidence (walk vendor + OSC title), the `setCommand`
   * payload upgrading a generic record to a named protocol, or null. Engine-
   * owned; the daemon only relays evidence. Absent = never upgrades.
   */
  resolveProtocolUpgrade?(
    task: Pick<DaemonTask, "vendor" | "command">,
    evidence: { readonly walkVendor: VendorId | null; readonly title: string },
  ): { command: string; vendor: VendorId } | null
  /**
   * Completed turns from ONE transcript via the vendor's adapter; `[]` when no
   * reader or unreadable. The daemon never parses a vendor transcript itself.
   */
  readEngineTurns(vendor: VendorId, transcriptPath: string): Promise<readonly AgentTurn[]>
  checkLatestVersion(): Promise<UpdateInfo | null>
  latestTranscriptMtime(vendor: VendorId, worktreePath: string): Promise<number>
  deriveTitleFromSession(worktreePath: string, vendor: VendorId): Promise<string>
  createEngineTurnDetector(vendor: VendorId): EngineTurnDetectorAdapter
  /** `baseRef` is the task's RECORDED fork point; absent/stale falls back to
   *  own resolution, and `behind` is omitted when nothing resolves. */
  runWorktreeStatus(worktreePath: string, signal: AbortSignal, baseRef?: string): Promise<WorktreeChanges>
  /**
   * The engine's own context-window reading for one session (vendor history
   * reader; never summed here). `null` = none reported, distinct from zero.
   */
  readEngineContextUsage(vendor: VendorId, sessionId: string): Promise<EngineContextUsage | null>
  maybeAutoStart(orch: DaemonOrchestrator, taskId: string): Promise<string>
  listWorktreeProjects(network: boolean): Promise<unknown[]>
  /**
   * Admin-dir NAMES that `git worktree list --porcelain` silently omitted
   * (unreadable admin dir; path/branch/head are lost with it). Best-effort, `[]`.
   */
  listUnreadableWorktrees(repo: string): Promise<readonly string[]>
  /** Resolves null on a clean removal, or the leftover directory when git
   *  deregistered but couldn't delete it (no retry can advance that). */
  removeWorktree(path: string, force: boolean): Promise<{ path: string; reason: string } | null>
  /**
   * Merge the base branch INTO the worktree. Rejects with `SYNC_CONFLICT:
   * <files>` / `SYNC_WORKTREE_DIRTY`, the typed-marker shape of `LAND_CONFLICT`.
   */
  syncWorktreeWithBase(
    worktreePath: string,
    recordedBaseRef: string | undefined,
  ): Promise<{ baseRef: string; alreadyCurrent: boolean }>
  availableEngineIds(): Promise<readonly VendorId[]>
  engineDisplayName(vendor: VendorId): string
  kobeApiInvocation(): string
  ensureTaskSession(link: DaemonRpcClient, taskId: string): Promise<{ session: string; worktreePath: string }>
  /**
   * Materialize the worktree and START the engine with `prompt` in its argv
   * (the spawning sibling of {@link deliverPromptToLiveEngine}). Argv, not a
   * paste: a cold engine can swallow a raced paste unnoticed.
   *
   * `started` = the ENGINE process was seen in the process table (PTY liveness
   * is the login shell's, true even for a missing binary). `error` is what the
   * session last printed — how a caller tells `code 127` from a real start.
   */
  startTaskSessionWithPrompt(
    link: DaemonRpcClient,
    taskId: string,
    prompt: string,
  ): Promise<{ started: boolean; error?: string }>
  tearDownTaskSession(taskId: string): Promise<void>
  /**
   * Vendor account usage windows, or null when unknowable. Hits the vendor's
   * rate-limited API — ONLY QuotaUsageCache may call this.
   */
  quotaUsage(vendor: VendorId): Promise<EngineQuotaUsage | null>
  /**
   * Vendors with a quota probe. Quota is ACCOUNT-level, so the poller walks
   * this, not vendors in open tasks — or a logged-in engine with no task never shows.
   */
  vendorsWithQuotaProbe(): readonly VendorId[]
  /** Deliver into the LIVE engine session only (never spawns); false if none. */
  deliverPromptToLiveEngine(
    task: {
      readonly id: string
      readonly vendor?: VendorId
      /** Raw launch command pinned on the task; wins over `vendor` when set. */
      readonly command?: string
      readonly worktreePath: string
    },
    prompt: string,
  ): Promise<boolean>
  /**
   * {@link deliverPromptToLiveEngine} reporting which tab and why not.
   * `no-engine` = alive session holding only the keepAlive shell; a paste
   * would EXECUTE the prompt, so the caller must revive, never deliver.
   */
  deliverPromptToLiveEngineDetailed(
    task: {
      readonly id: string
      readonly vendor?: VendorId
      readonly command?: string
      readonly worktreePath: string
    },
    prompt: string,
  ): Promise<
    | { readonly outcome: "delivered"; readonly tabId: string }
    | { readonly outcome: "no-session" }
    | { readonly outcome: "no-engine"; readonly tabId: string }
  >
  /** Deliver to one exact live tab; never reroutes to tab-1 (wrong engine). */
  deliverPromptToLiveEngineTabDetailed(
    target: {
      readonly id: string
      readonly tabId: string
      readonly vendor?: VendorId
      readonly command?: string
      readonly worktreePath: string
    },
    prompt: string,
  ): Promise<
    | { readonly outcome: "delivered"; readonly tabId: string }
    | { readonly outcome: "no-session" }
    | { readonly outcome: "no-engine"; readonly tabId: string }
  >
  getPersistedString(key: string): string | undefined
  setPersistedString(key: string, value: string): void
  getSavedRepos(): readonly string[]
  engineEntry(vendor: VendorId): { effortLevels?: readonly string[] }
  prStatus: {
    /** `--json` fields for `gh pr view`/`list`; shared with the mapper's shape. */
    viewFields: string
    mapView(view: unknown, at: string): NonNullable<DaemonTask["prStatus"]> | null
    sameStatus(a: DaemonTask["prStatus"] | null, b: DaemonTask["prStatus"] | null): boolean
    nextPoll(
      outcome: unknown,
      failures: number,
      now: number,
      config: unknown,
      random?: () => number,
    ): {
      nextAllowedAt: number
      failures: number
    }
    /** Classify a failed `gh` run. Never infers "no PR" — that's an empty-array
     * SUCCESS the caller detects first. */
    classify(signals: {
      spawnError?: boolean
      timedOut?: boolean
      exitCode?: number | null
      stderr?: string
      parseError?: boolean
    }): { kind: "error"; error: string }
  }
}

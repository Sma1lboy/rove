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
  /** {@link latestActivity} scoped to one session transcript; `null` = not
   *  supported by this vendor (or file gone) — fall back to the worktree scan. */
  latestActivityInFile(transcriptPath: string): Promise<{
    marker: { id: string; timestampMs: number } | null
    mtimeMs: number
  } | null>
  supportsCompletionMarkers(): boolean
}

/** The cadence knobs + per-key state the scheduling core reads and writes.
 *  Re-exported, not restated: this file used to carry its own copies of both
 *  shapes alongside the ones in `poll-scheduling.ts`. */
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
   * Foreground engine per session root pid — ONE `ps` snapshot walked per
   * pid (kobe's `engine/foreground.ts`, the same primitive `kobe api
   * inspect` uses). The engine's own vendor AND pid, or null for "no engine
   * in this tree". Consumed by the daemon activity observer's reconciler
   * the pid is what a death record names as the process
   * that actually died, distinct from the PTY that outlived it.
   */
  foregroundEngines(pids: readonly number[]): Promise<ReadonlyMap<number, { vendor: VendorId; pid: number } | null>>
  /**
   * Engine-owned verdict on a live OSC title (`engineTitleTurnHint`):
   * "working" while the vendor's animated frame prefixes it, "rest" when a
   * status-owning vendor wrote a title without one, null when the vendor
   * declares no vocabulary (or the title is empty) — never guessed.
   */
  titleTurnHint(vendor: VendorId, title: string): "working" | "rest" | null
  /**
   * Tier-(b) protocol sniff consumer: given a task record and
   * live evidence from its engine tab (foreground-walk vendor + OSC title),
   * the `setCommand` payload that upgrades a generic record to the named
   * protocol — or null to leave the record alone. Naming + eligibility are
   * engine-owned (kobe's `engine/protocol-sniff.ts`); the daemon only
   * relays evidence. Optional: a runtime without it never upgrades.
   */
  resolveProtocolUpgrade?(
    task: Pick<DaemonTask, "vendor" | "command">,
    evidence: { readonly walkVendor: VendorId | null; readonly title: string },
  ): { command: string; vendor: VendorId } | null
  /**
   * Engine-owned per-turn telemetry: completed turns read out of
   * ONE session transcript by the vendor's own adapter. `[]` when the engine
   * ships no turn reader or the file is unreadable — the daemon never parses
   * a vendor transcript itself.
   */
  readEngineTurns(vendor: VendorId, transcriptPath: string): Promise<readonly AgentTurn[]>
  checkLatestVersion(): Promise<UpdateInfo | null>
  latestTranscriptMtime(vendor: VendorId, worktreePath: string): Promise<number>
  deriveTitleFromSession(worktreePath: string, vendor: VendorId): Promise<string>
  createEngineTurnDetector(vendor: VendorId): EngineTurnDetectorAdapter
  /** `baseRef` is the owning task's RECORDED fork point; the implementation
   *  falls back to its own resolution ladder when it is absent or stale, and
   *  omits `behind` when nothing resolves. */
  runWorktreeStatus(worktreePath: string, signal: AbortSignal, baseRef?: string): Promise<WorktreeChanges>
  /**
   * The engine's own context-window reading for one live session. Delegated
   * straight to the vendor's history reader — the daemon never sums vendor
   * fields itself. `null` when the engine reports none (custom engines, a
   * session with no transcript yet, kimi's unverified wire), which is
   * different from a reported zero.
   */
  readEngineContextUsage(vendor: VendorId, sessionId: string): Promise<EngineContextUsage | null>
  maybeAutoStart(orch: DaemonOrchestrator, taskId: string): Promise<string>
  listWorktreeProjects(network: boolean): Promise<unknown[]>
  /**
   * Worktree admin-dir NAMES that `git worktree list --porcelain` omitted
   * without an error or a non-zero exit — git's own silence about a worktree
   * whose admin dir it cannot read. Names only: an unreadable admin dir takes
   * its path/branch/head with it. Best-effort, `[]` when nothing to report or
   * nothing could be enumerated.
   */
  listUnreadableWorktrees(repo: string): Promise<readonly string[]>
  /** Remove a worktree. Resolves with the leftover directory when git
   *  deregistered the worktree but could not delete it (a partial removal that
   *  no retry can advance); resolves with null on a clean removal. */
  removeWorktree(path: string, force: boolean): Promise<{ path: string; reason: string } | null>
  /**
   * Merge a task's base branch INTO its worktree (the sidebar's "Sync with
   * base"). Rejects with a `SYNC_CONFLICT: <files>` / `SYNC_WORKTREE_DIRTY`
   * message on the two outcomes a human acts on — the same typed-marker shape
   * `landTask` uses for `LAND_CONFLICT`.
   */
  syncWorktreeWithBase(
    worktreePath: string,
    recordedBaseRef: string | undefined,
  ): Promise<{ baseRef: string; alreadyCurrent: boolean }>
  availableEngineIds(): Promise<readonly VendorId[]>
  engineDisplayName(vendor: VendorId): string
  kobeApiInvocation(): string
  engineSpec(link: DaemonRpcClient, taskId: string): Promise<{ cwd: string; command: string[]; firstMessage?: string }>
  terminalSpec(link: DaemonRpcClient, taskId: string): Promise<{ cwd: string; command: string[] }>
  ensureTaskSession(link: DaemonRpcClient, taskId: string): Promise<{ session: string; worktreePath: string }>
  /**
   * Materialize a task's worktree and START its engine with `prompt` as the
   * launch-time first message.
   *
   * The spawning sibling of {@link deliverPromptToLiveEngine}, which exists for
   * the opposite case (resume a session that is already alive, never spawn).
   * An automation run has no prior session by construction, so it needs this
   * one. The prompt rides the engine's own argv rather than being typed into
   * the PTY afterwards — a cold engine can swallow a raced paste, and an
   * unattended run has nobody watching to notice.
   *
   * `started` means the ENGINE process was seen running. The adapter looks at
   * the process table to answer that, because the PTY's own liveness is the
   * login shell's and stays true for an engine binary that does not exist.
   * `error` carries what the session last printed, which is the only thing
   * that can tell an unattended caller a `code 127` from a real start.
   */
  startTaskSessionWithPrompt(
    link: DaemonRpcClient,
    taskId: string,
    prompt: string,
  ): Promise<{ started: boolean; error?: string }>
  tearDownTaskSession(taskId: string): Promise<void>
  /**
   * Engine-owned subscription-quota probe: snapshot of the vendor account's
   * usage windows, or null when unknowable (no login, no quota API, network
   * failure). The probe hits the vendor's own rate-limited API — ONLY the
   * daemon's QuotaUsageCache may call this; everything else reads the cache.
   */
  quotaUsage(vendor: VendorId): Promise<EngineQuotaUsage | null>
  /**
   * Vendors whose adapter ships a quota probe at all. Quota is ACCOUNT-level,
   * so the usage poller walks this list rather than the vendors currently in
   * play across tasks — otherwise an engine the user is logged into but has
   * no open task for never gets asked, and its balance silently never shows.
   */
  vendorsWithQuotaProbe(): readonly VendorId[]
  /**
   * Deliver a prompt into a task's LIVE hosted engine session only (never
   * spawns). Returns false when no alive engine session exists.
   */
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
   * {@link deliverPromptToLiveEngine} with the composer-busy outcome as DATA
   * rather than a thrown `ComposerBusyError` — the error class lives in the
   * `rove` package, which depends on this one, so the daemon cannot catch it
   * by type. A caller that must not drop the prompt (a routine's daily
   * report) reads `busy` and files a deferral; quota-resume keeps using the
   * boolean form, where dropping is the right answer.
   *
   * `tabId` names which tab the live engine was found on, so the deferral and
   * its Inbox episode point at the tab a human will actually open.
   *
   * `no-engine` is a session that is alive with no engine IN it — keepAlive
   * left a login shell where the engine exited. It is separate from
   * `no-session` because pasting there would have the shell EXECUTE the
   * prompt; the caller must revive, never deliver.
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
    | {
        readonly outcome: "busy"
        readonly tabId: string
        readonly layer: "recent-human-write" | "composer-not-empty"
      }
  >
  /**
   * Deliver to one exact live tab. Used when draining daemon-owned deferred
   * prompts: rerouting a queued tab-2 message into tab-1 would be data loss.
   */
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
    | {
        readonly outcome: "busy"
        readonly tabId: string
        readonly layer: "recent-human-write" | "composer-not-empty"
      }
  >
  /** Fresh persisted state, checked between deferred-queue deliveries. */
  composerGateEnabled(): boolean
  settingsSnapshot(): Response
  settingsPatch(request: Request): Promise<Response>
  handleDiffRequest(request: Request, url: URL): Promise<Response | null>
  handleHistoryRequest(request: Request, url: URL): Promise<Response | null>
  handleNotesRequest(request: Request, url: URL): Promise<Response | null>
  handleThemesRequest(request: Request, url: URL): Response | null
  handleWorktreesRequest(request: Request, url: URL): Promise<Response | null>
  issueAssetsDir(): string
  getPersistedString(key: string): string | undefined
  setPersistedString(key: string, value: string): void
  getSavedRepos(): readonly string[]
  engineEntry(vendor: VendorId): { effortLevels?: readonly string[] }
  prStatus: {
    /** The `--json` field set `gh pr view`/`gh pr list` request — single source
     * for the daemon's `gh` calls and the pure mapper's expected shape. */
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
    /** Classify a non-success `gh` run into a typed transport/tooling error.
     * Pure — see `monitor/pr-status.ts`. "No PR" is never inferred here; it's
     * a structural empty-array SUCCESS the caller detects before falling back
     * to this classifier. */
    classify(signals: {
      spawnError?: boolean
      timedOut?: boolean
      exitCode?: number | null
      stderr?: string
      parseError?: boolean
    }): { kind: "error"; error: string }
  }
}

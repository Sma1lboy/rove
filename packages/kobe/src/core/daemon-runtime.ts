/** Production Adapter for the daemon package's consumer-owned runtime seam. */

import type { DaemonRuntimeAdapter } from "@sma1lboy/kobe-daemon/daemon/runtime"
import { parseAheadBehind } from "@sma1lboy/kobe-daemon/daemon/worktree-changes-collector"
import { availableEngineIds } from "../engine/account-detect.ts"
import { engineProtocolKey, protocolEntry, sessionProtocol } from "../engine/engine-presets.ts"
import { foregroundEngineIn, parsePsSnapshot, psSnapshot } from "../engine/foreground.ts"
import { affectsActivityState, isEngineActivityKind } from "../engine/hook-events.ts"
import { engineDisplayName, kobeApiInvocation } from "../engine/interactive-command.ts"
import { protocolUpgradeFromLiveSession, protocolWriteBackFromLiveSession } from "../engine/protocol-sniff.ts"
import { engineEntry, engineTitleTurnHint, vendorsWithQuotaProbe } from "../engine/registry.ts"
import { createEngineTurnDetector } from "../engine/turn-detector.ts"
import { readOnlyGitProcessEnv } from "../lib/git-env.ts"
import { spawnCapture } from "../lib/poll-scheduling.ts"
import { latestTranscriptMtime } from "../monitor/activity.ts"
import { deriveTitleFromSession } from "../monitor/auto-title.ts"
import { GH_PR_VIEW_FIELDS, classifyGhFailure, mapGhPrView, nextPrPoll, samePrStatus } from "../monitor/pr-status.ts"
import { maybeAutoStart } from "../monitor/status-rules.ts"
import { type Orchestrator, PLACEHOLDER_TASK_TITLE } from "../orchestrator/core.ts"
import { SYNC_TIMEOUT_MS, syncWorktreeWithBase } from "../orchestrator/sync-base.ts"
import { getCustomEngineIds, getPersistedString, getSavedRepos, setPersistedString } from "../state/repos.ts"
import { parsePorcelain } from "../tui/panes/sidebar/worktree-changes.ts"
import { DEFAULT_TASK_VENDOR, isTaskStatus } from "../types/task.ts"
import type { VendorId } from "../types/vendor.ts"
import { CURRENT_VERSION, checkLatestVersion } from "../version.ts"
import { resolveBaseRefCached } from "./base-ref-cache.ts"
import { driftCached } from "./behind-cache.ts"
import {
  deliverPromptToLiveEngineAdapter,
  deliverPromptToLiveEngineDetailedAdapter,
  deliverPromptToLiveEngineTabDetailedAdapter,
  ensureTaskSessionAdapter,
  startTaskSessionWithPromptAdapter,
  tearDownTaskSessionAdapter,
} from "./daemon-session-adapter.ts"
import {
  listUnreadableWorktreesAdapter,
  listWorktreeProjectsAdapter,
  removeWorktreeAdapter,
} from "./daemon-worktree-adapter.ts"

/**
 * The observer's protocol hook, doing tier (b)'s two jobs in one pass: name
 * THIS task's record (returned to the daemon, which writes it via
 * `setCommand`) and — separately — learn the custom PRESET's protocol, so the
 * next task launched on that preset starts named instead of re-sniffing.
 *
 * Both rules live in `protocol-sniff.ts`; the preset write is here because it
 * is the only half that touches state.json, and it is a write rather than a
 * return value because the daemon's `resolveProtocolUpgrade` contract is
 * about one task's record. Idempotent — the key it writes is what makes the
 * next call refuse — so no dedupe is needed around it.
 */
function resolveProtocolUpgradeAndLearnPreset(
  task: { readonly vendor?: string; readonly command?: string },
  evidence: { readonly walkVendor: VendorId | null; readonly title: string },
): { command: string; vendor: VendorId } | null {
  const preset = protocolWriteBackFromLiveSession(task, evidence, getCustomEngineIds())
  if (preset) setPersistedString(engineProtocolKey(preset.id), preset.protocol)
  return protocolUpgradeFromLiveSession(task, evidence)
}

export const daemonRuntime: DaemonRuntimeAdapter = {
  currentVersion: CURRENT_VERSION,
  defaultTaskVendor: DEFAULT_TASK_VENDOR,
  placeholderTaskTitle: PLACEHOLDER_TASK_TITLE,
  isTaskStatus,
  isEngineActivityKind,
  affectsActivityState,
  // The activity observer's foreground walk: ONE `ps`
  // snapshot, then the same shallowest-engine walk `kobe api inspect` uses.
  async foregroundEngines(pids) {
    const rows = parsePsSnapshot(await psSnapshot([...pids]))
    const out = new Map<number, { vendor: VendorId; pid: number } | null>()
    for (const pid of pids) {
      const found = foregroundEngineIn(rows, pid)
      out.set(pid, found ? { vendor: found.vendor, pid: found.pid } : null)
    }
    return out
  },
  // Protocol-keyed, like every other "how do we talk to it" read in this
  // object: a `claudecpa` task's OSC title is claude's, and `registry.ts`
  // stays state-free so it cannot resolve the preset itself. Keying off the
  // raw id finds the empty custom entry, whose `terminalTitle` is undefined
  // — `titleTurnHint` then answers null forever and the interrupt observer
  // never sees working→rest on a wrapped tab.
  titleTurnHint: (vendor, title) => engineTitleTurnHint(sessionProtocol(vendor), title),
  // Tier-(b) protocol sniff: the record upgrade for a generic
  // task identified by its live session, plus the preset write-back —
  // rules live with the sniffer.
  resolveProtocolUpgrade: resolveProtocolUpgradeAndLearnPreset,
  // Per-turn telemetry — delegated straight to the vendor's own
  // adapter; an engine without a turn reader simply reports none.
  readEngineTurns: async (vendor, transcriptPath) => (await protocolEntry(vendor).readTurns?.(transcriptPath)) ?? [],
  checkLatestVersion,
  latestTranscriptMtime,
  deriveTitleFromSession,
  createEngineTurnDetector: (vendor) => createEngineTurnDetector(sessionProtocol(vendor)),
  async runWorktreeStatus(worktreePath, signal, baseRef) {
    const result = await spawnCapture("git", ["status", "--porcelain=v1"], {
      cwd: worktreePath,
      env: readOnlyGitProcessEnv(),
      signal,
    })
    if (result.status !== 0) throw new Error("git status failed")
    const counts = parsePorcelain(result.stdout)
    // The base drift BOTH ways, on the SAME guarded run as the status walk so
    // it inherits its in-flight dedupe, timeout and backoff. One
    // `--left-right --count` process yields behind and ahead together: two
    // separate counts would cost a second fork per poll per worktree and
    // could straddle a commit, reporting a pair that never coexisted. The
    // base resolution ladder lives here rather than in the daemon:
    // `resolveBaseRef` is kobe's, and kobe-daemon does not import kobe
    // sources.
    const base = await resolveBaseRefCached(worktreePath, baseRef, signal)
    if (!base) return counts
    // Memoised on the HEAD/base shas read from the ref files: the counts can
    // only move when one of them does, and re-deriving them every tick was
    // half the collector's spawns.
    const drift = await driftCached(worktreePath, base, async () => {
      const out = await spawnCapture("git", ["rev-list", "--left-right", "--count", `${base}...HEAD`], {
        cwd: worktreePath,
        env: readOnlyGitProcessEnv(),
        signal,
      })
      return out.status === 0 ? parseAheadBehind(out.stdout) : null
    })
    return drift === null ? counts : { ...counts, ...drift }
  },
  maybeAutoStart: (orch, taskId) => maybeAutoStart(orch as Orchestrator, taskId),
  listWorktreeProjects: listWorktreeProjectsAdapter,
  listUnreadableWorktrees: listUnreadableWorktreesAdapter,
  removeWorktree: removeWorktreeAdapter,
  async syncWorktreeWithBase(worktreePath, recordedBaseRef) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS)
    try {
      const baseRef = await resolveBaseRefCached(worktreePath, recordedBaseRef, controller.signal)
      if (!baseRef) throw new Error("no base ref resolves for this worktree")
      return await syncWorktreeWithBase(worktreePath, baseRef, controller.signal)
    } finally {
      clearTimeout(timer)
    }
  },
  availableEngineIds,
  engineDisplayName,
  kobeApiInvocation,
  engineEntry,
  ensureTaskSession: ensureTaskSessionAdapter,
  startTaskSessionWithPrompt: startTaskSessionWithPromptAdapter,
  tearDownTaskSession: tearDownTaskSessionAdapter,
  // Delegated straight to the vendor's own history reader: what counts as
  // "context" and what counts toward a token total are both vendor
  // arithmetic, and the neutral layers only carry and render the result. The
  // same read already produced the four token counts — dropping them here was
  // paying for the parse and throwing away most of what it returned.
  //
  // `context_tokens` stays the gate: no context reading, no entry, so the
  // footer meter's behaviour is unchanged. Each token count is carried only
  // when the adapter reported it; a missing field stays missing rather than
  // becoming a fabricated `0`.
  async readEngineContextUsage(vendor, sessionId) {
    const read = protocolEntry(vendor).history.readUsageSnapshot
    if (!read) return null
    const snapshot = await read(sessionId)
    if (snapshot?.context_tokens === undefined) return null
    return {
      contextTokens: snapshot.context_tokens,
      ...(snapshot.context_window_tokens === undefined ? {} : { contextWindowTokens: snapshot.context_window_tokens }),
      ...(snapshot.context_tokens_approximate ? { approximate: true } : {}),
      ...(snapshot.input_tokens === undefined ? {} : { inputTokens: snapshot.input_tokens }),
      ...(snapshot.output_tokens === undefined ? {} : { outputTokens: snapshot.output_tokens }),
      ...(snapshot.cache_read_input_tokens === undefined ? {} : { cacheReadTokens: snapshot.cache_read_input_tokens }),
      ...(snapshot.cache_creation_input_tokens === undefined
        ? {}
        : { cacheCreationTokens: snapshot.cache_creation_input_tokens }),
    }
  },
  quotaUsage: (vendor) => engineEntry(vendor).quotaUsage?.() ?? Promise.resolve(null),
  vendorsWithQuotaProbe,
  deliverPromptToLiveEngine: deliverPromptToLiveEngineAdapter,
  deliverPromptToLiveEngineDetailed: deliverPromptToLiveEngineDetailedAdapter,
  deliverPromptToLiveEngineTabDetailed: deliverPromptToLiveEngineTabDetailedAdapter,
  getPersistedString,
  setPersistedString,
  getSavedRepos: () => [...getSavedRepos()],
  prStatus: {
    viewFields: GH_PR_VIEW_FIELDS,
    mapView: (view, at) => mapGhPrView(view as never, at),
    sameStatus: samePrStatus,
    nextPoll: (outcome, failures, now, config, random) =>
      nextPrPoll(outcome as never, failures, now, config as never, random),
    classify: classifyGhFailure,
  },
}

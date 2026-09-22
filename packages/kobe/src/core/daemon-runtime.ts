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
 * Tier-(b) protocol sniff: returns THIS task's record upgrade (the daemon
 * writes it via `setCommand`) and persists the custom PRESET's protocol so
 * the next task on it starts named. Rules live in `protocol-sniff.ts`. The
 * preset write is idempotent: the key it writes makes the next call refuse.
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
  // ONE `ps` snapshot, then the same shallowest-engine walk `api inspect` uses.
  async foregroundEngines(pids) {
    const rows = parsePsSnapshot(await psSnapshot([...pids]))
    const out = new Map<number, { vendor: VendorId; pid: number } | null>()
    for (const pid of pids) {
      const found = foregroundEngineIn(rows, pid)
      out.set(pid, found ? { vendor: found.vendor, pid: found.pid } : null)
    }
    return out
  },
  // Protocol-keyed: a `claudecpa` task's OSC title is claude's, and
  // state-free `registry.ts` can't resolve presets. The raw id finds an empty
  // custom entry, so working→rest would never be seen on a wrapped tab.
  titleTurnHint: (vendor, title) => engineTitleTurnHint(sessionProtocol(vendor), title),
  resolveProtocolUpgrade: resolveProtocolUpgradeAndLearnPreset,
  // An engine without a turn reader reports none.
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
    // Base drift on the SAME guarded run as the status walk (inherits its
    // dedupe, timeout, backoff). One `--left-right --count` yields both
    // sides: two counts could straddle a commit. The ladder lives here
    // because kobe-daemon does not import kobe sources.
    const base = await resolveBaseRefCached(worktreePath, baseRef, signal)
    if (!base) return counts
    // Memoised on HEAD/base shas from ref files (was half the collector's spawns).
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
  // Vendor history does the token arithmetic; neutral layers only carry it.
  // No `context_tokens` = no entry. A missing count stays missing, never `0`.
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

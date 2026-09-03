/** Production Adapter for the daemon package's consumer-owned runtime seam. */

import type { DaemonRuntimeAdapter } from "@sma1lboy/kobe-daemon/daemon/runtime"
import { availableEngineIds } from "../engine/account-detect.ts"
import { engineProtocolKey } from "../engine/engine-presets.ts"
import { foregroundEngineIn, parsePsSnapshot, psSnapshot } from "../engine/foreground.ts"
import { affectsActivityState, isEngineActivityKind } from "../engine/hook-events.ts"
import { engineDisplayName, kobeApiInvocation } from "../engine/interactive-command.ts"
import { protocolUpgradeFromLiveSession, protocolWriteBackFromLiveSession } from "../engine/protocol-sniff.ts"
import { engineEntry, engineTitleTurnHint, vendorsWithQuotaProbe } from "../engine/registry.ts"
import { createEngineTurnDetector } from "../engine/turn-detector.ts"
import { issueAssetsDir } from "../env.ts"
import { readOnlyGitProcessEnv } from "../lib/git-env.ts"
import { spawnCapture } from "../lib/poll-scheduling.ts"
import { latestTranscriptMtime } from "../monitor/activity.ts"
import { deriveTitleFromSession } from "../monitor/auto-title.ts"
import { GH_PR_VIEW_FIELDS, classifyGhFailure, mapGhPrView, nextPrPoll, samePrStatus } from "../monitor/pr-status.ts"
import { maybeAutoStart } from "../monitor/status-rules.ts"
import { type Orchestrator, PLACEHOLDER_TASK_TITLE } from "../orchestrator/core.ts"
import { SYNC_TIMEOUT_MS, syncWorktreeWithBase } from "../orchestrator/sync-base.ts"
import { composerGateEnabled } from "../state/composer-gate.ts"
import { getCustomEngineIds, getPersistedString, getSavedRepos, setPersistedString } from "../state/repos.ts"
import { parsePorcelain } from "../tui/panes/sidebar/worktree-changes.ts"
import { DEFAULT_TASK_VENDOR, isTaskStatus } from "../types/task.ts"
import type { VendorId } from "../types/vendor.ts"
import { CURRENT_VERSION, checkLatestVersion } from "../version.ts"
import { handleDiffRequest } from "../web/diff.ts"
import { handleHistoryRequest } from "../web/history.ts"
import { handleNotesRequest } from "../web/notes.ts"
import { handleThemesRequest } from "../web/themes.ts"
import { resolveBaseRefCached } from "./base-ref-cache.ts"
import {
  deliverPromptToLiveEngineAdapter,
  deliverPromptToLiveEngineDetailedAdapter,
  deliverPromptToLiveEngineTabDetailedAdapter,
  engineSpecAdapter,
  ensureTaskSessionAdapter,
  startTaskSessionWithPromptAdapter,
  tearDownTaskSessionAdapter,
  terminalSpecAdapter,
} from "./daemon-session-adapter.ts"
import { daemonSettingsPatch, daemonSettingsSnapshot } from "./daemon-settings-adapter.ts"
import {
  handleWorktreesRequestAdapter,
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
    const rows = parsePsSnapshot(await psSnapshot())
    const out = new Map<number, { vendor: VendorId; pid: number } | null>()
    for (const pid of pids) {
      const found = foregroundEngineIn(rows, pid)
      out.set(pid, found ? { vendor: found.vendor, pid: found.pid } : null)
    }
    return out
  },
  titleTurnHint: engineTitleTurnHint,
  // Tier-(b) protocol sniff: the record upgrade for a generic
  // task identified by its live session, plus the preset write-back —
  // rules live with the sniffer.
  resolveProtocolUpgrade: resolveProtocolUpgradeAndLearnPreset,
  // Per-turn telemetry — delegated straight to the vendor's own
  // adapter; an engine without a turn reader simply reports none.
  readEngineTurns: async (vendor, transcriptPath) => (await engineEntry(vendor).readTurns?.(transcriptPath)) ?? [],
  checkLatestVersion,
  latestTranscriptMtime,
  deriveTitleFromSession,
  createEngineTurnDetector,
  async runWorktreeStatus(worktreePath, signal, baseRef) {
    const result = await spawnCapture("git", ["status", "--porcelain=v1"], {
      cwd: worktreePath,
      env: readOnlyGitProcessEnv(),
      signal,
    })
    if (result.status !== 0) throw new Error("git status failed")
    const counts = parsePorcelain(result.stdout)
    // The behind-base drift, on the SAME guarded run as the status walk so it
    // inherits its in-flight dedupe, timeout and backoff. The base resolution
    // ladder lives here rather than in the daemon: `resolveBaseRef` is kobe's,
    // and kobe-daemon does not import kobe sources.
    const base = await resolveBaseRefCached(worktreePath, baseRef, signal)
    if (!base) return counts
    const behind = await spawnCapture("git", ["rev-list", "--count", `HEAD..${base}`], {
      cwd: worktreePath,
      env: readOnlyGitProcessEnv(),
      signal,
    })
    if (behind.status !== 0) return counts
    const n = Number.parseInt(behind.stdout.trim(), 10)
    return Number.isInteger(n) && n >= 0 ? { ...counts, behind: n } : counts
  },
  maybeAutoStart: (orch, taskId) => maybeAutoStart(orch as Orchestrator, taskId),
  listWorktreeProjects: listWorktreeProjectsAdapter,
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
  engineSpec: engineSpecAdapter,
  terminalSpec: terminalSpecAdapter,
  ensureTaskSession: ensureTaskSessionAdapter,
  startTaskSessionWithPrompt: startTaskSessionWithPromptAdapter,
  tearDownTaskSession: tearDownTaskSessionAdapter,
  quotaUsage: (vendor) => engineEntry(vendor).quotaUsage?.() ?? Promise.resolve(null),
  vendorsWithQuotaProbe,
  deliverPromptToLiveEngine: deliverPromptToLiveEngineAdapter,
  deliverPromptToLiveEngineDetailed: deliverPromptToLiveEngineDetailedAdapter,
  deliverPromptToLiveEngineTabDetailed: deliverPromptToLiveEngineTabDetailedAdapter,
  composerGateEnabled,
  settingsSnapshot: daemonSettingsSnapshot,
  settingsPatch: daemonSettingsPatch,
  handleDiffRequest,
  handleHistoryRequest,
  handleNotesRequest,
  handleThemesRequest,
  handleWorktreesRequest: handleWorktreesRequestAdapter,
  issueAssetsDir,
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

/**
 * Push-channel registry — the single source of truth for daemon→client push
 * channels, plus subscribe-filter helpers. Re-exported from `protocol.ts`,
 * the one public import path for the wire protocol.
 */

import { DAEMON_CHANNELS } from "@sma1lboy/rove-plugin-sdk/contract"
import type {
  EngineLifecyclePayload,
  GraphicsWritePayload,
  NoticeEventPayload,
  SessionDeliverPayload,
  TabClosePayload,
  TabOpenPayload,
  TabRenamePayload,
  UiPromptPayload,
} from "./channels-events.ts"
import type {
  AttentionInboxItem,
  EngineActivityDetail,
  EngineContextUsage,
  EngineQuotaUsage,
  TaskActivityState,
  UpdateInfo,
} from "./contracts.ts"
export type {
  CellPixelSize,
  EngineLifecyclePayload,
  GraphicsWritePayload,
  NoticeEventPayload,
  PaneClosePayload,
  SessionDeliverPayload,
  TabClosePayload,
  TabOpenPayload,
  TabRenamePayload,
  TerminalTabClosePayload,
  UiPromptPayload,
} from "./channels-events.ts"
import type { RepoIssues } from "./issues-store.ts"
import type { SerializedTask } from "./protocol.ts"
import type { RowTokenMap } from "./row-tokens.ts"

/**
 * Daemon→client push channels. Each carries a last value the daemon caches
 * and replays to a late subscriber (`daemon/event-bus.ts`). Adding a key here
 * types `bus.publish`, `client.onChannel` and the replay; nothing else needs
 * touching.
 *
 * Per-socket delivery is FIFO; cross-channel ordering is not guaranteed.
 * Last-value replay suits STATE channels; an EVENT channel replays only its
 * last item, so its consumers dedupe on `at` and drop stale replays.
 */
export interface ChannelPayloads {
  "task.snapshot": { tasks: SerializedTask[] }
  /**
   * One repo's full issue state (not a delta), published after every
   * `issue.mutate`; replay carries only the most recently changed repo.
   *
   * No in-repo subscriber (the TUI uses `issue.list` / `issue.mutate`), but it
   * is public plugin API (`DAEMON_CHANNELS`, `docs/PLUGIN-SDK.md`), so it stays.
   * Writers go through `publishIssueSnapshot` (`handlers-issues.ts`), gated on
   * `lifetime.hasSubscribersFor`: free with nobody attached.
   */
  "issue.snapshot": RepoIssues
  /**
   * The task last switched into, shared so every Tasks pane and the monitor
   * highlight the same focus. `null` = none yet. Set via `task.setActive`.
   */
  "active-task": { taskId: string | null }
  /**
   * Latest published version, polled by the daemon so panes don't each hit
   * npm. `null` when suppressed (dev mode) or unavailable (offline).
   */
  update: { info: UpdateInfo | null }
  /**
   * What ONE task's engine is doing right now (running / turn done /
   * rate-limited / awaiting permission), reduced from hook verbs
   * ({@link import("../engine/hook-events").reduceActivity}). Distinct from
   * `task.snapshot`'s lifecycle status. Replay gives only the most recent
   * task's state; the daemon lets a state lapse back to idle.
   */
  "engine-state": {
    taskId: string
    /** The engine tab (`KOBE_TAB_ID` inherited by the hook process). Absent
     *  for sessions Rove didn't spawn as a tab (manual `claude` in a shell). */
    tabId?: string
    state: TaskActivityState
    detail?: EngineActivityDetail
    /** The engine's own session id from the hook payload, carried forward
     *  across events that omit it. Covers user-typed engines (cwd-matched). */
    sessionId?: string
    /** The session's transcript file, when the hook payload names it. */
    transcriptPath?: string
    at: number
  }
  /**
   * Full durable attention queue. Viewing never consumes an item: an episode
   * leaves only after a newer same-tab `turn-start`, explicit dismissal, or an
   * explicit hard-delete of its task. Full snapshots make reconnect stateless.
   */
  "attention.inbox": { items: AttentionInboxItem[] }
  /**
   * `state.json` visual prefs, pushed when the daemon's watcher sees them
   * change, so a theme switch, Tasks-pane sort (`t`), keys fold (`?`) or
   * project scope (`ctrl+p`) in one session applies to every session's panes
   * (otherwise each reads once at boot). Replay hydrates a late subscriber.
   * The daemon mirrors the file unvalidated; the TUI validates.
   */
  "ui-prefs": {
    /** Theme name, or `null` when unset. The daemon has no theme registry, so
     *  a default here would be a drifting copy of the TUI's. `null` = no
     *  opinion: `applyUiPrefs` keeps the pane's current theme. */
    theme: string | null
    /** `themeMode` (`dark`/`light`/`auto`), `null` when unset or unknown.
     *  Absent from older daemons — the TUI then leaves its mode alone. */
    themeMode?: string | null
    transparentBackground: boolean
    /** Raw slot string; `null` = the default slot. */
    focusAccent: string | null
    /** UI language id (`state.json`'s `locale`). Opaque to the daemon — the TUI validates it. */
    locale: string
    sortMode: "default" | "recent" | "attention"
    keysCollapsed: boolean
    projectFilter: string | null
  }
  /**
   * "Re-read `~/.rove/settings/keybindings.yaml`" ping; every pane re-applies
   * it onto its `KobeKeymap`. `rev` is an opaque token — only transitions
   * matter; panes skip the first (replayed) value since they read it at boot.
   */
  keybindings: { rev: number }
  /**
   * Plugin-written row tokens, the FULL map, republished on every write and
   * as each token's TTL expires (`row-tokens.ts`) — the expiry republish is
   * what makes an abandoned label fade.
   */
  "task.tokens": { tokens: RowTokenMap }
  "task.jobs": {
    // Progress of a minute-class op on one task (`task.ensureWorktree`), so
    // every attached Tasks pane, not just the initiator, shows it. Additive:
    // the RPC still blocks on the result.
    //
    // The publisher MUST emit a terminal phase (`done`/`error`), including on
    // throw. Replayed terminal phases are harmless (clients remove the entry);
    // a replayed `running` means the op is genuinely in flight (the bus dies
    // with the daemon). With two overlapping jobs, replay carries only the last.
    taskId: string
    kind: "ensureWorktree"
    phase: "running" | "done" | "error"
    /** Present only on `phase: "error"` — the thrown message, for UI hints. */
    error?: string
  }
  /**
   * Uncommitted-change counts; the daemon is the single `git status`
   * collector so panes don't each poll. FULL map (absolute local worktree path
   * → counts), republished only on change, so one replayed frame is the whole
   * picture. Remote (`ssh://`) projects are never collected; a deleted task
   * drops on the next tick. Clients whose daemon lacks the channel (per
   * `hello.capabilities`) poll locally.
   */
  "worktree.changes": {
    changes: Record<string, { added: number; deleted: number }>
    /**
     * Worktrees whose `git status` failed, so a subscriber can tell "could not
     * read" from "not collected" — both are absent from `changes`, which the
     * sidebar would render as clean, the signal a user checks before deleting.
     * Absent from older daemons = nothing unreadable.
     */
    unreadable?: string[]
  }
  /**
   * Transcript facts per worktree from one collector
   * (`daemon/transcript-activity-collector.ts`) instead of every Ops pane
   * stat-ing and parsing JSONL: newest transcript mtime + the engine-owned
   * completion marker. The quiescence check and pane-local state writes stay
   * in the Ops pane — the daemon never touches front-end state.
   *
   * Same full-map contract as `worktree.changes`. `completionId` is the
   * engine's opaque marker id (`null` if none); `completionAt` its epoch ms
   * (`0` if absent). Older daemons (absent from `hello.capabilities`) → the
   * Ops pane polls locally.
   */
  "transcript.activity": {
    activity: Record<string, { mtimeMs: number; completionId: string | null; completionAt: number }>
  }
  /**
   * Text to paste into a task's live engine session (docs/design/dispatcher.md).
   * The daemon never delivers: whichever front-end hosts the session does.
   * Producers: `note.file` (`source: "note"`, to the repo's main-task
   * dispatcher) and `session.deliver` (`kobe api dispatch`,
   * `source: "dispatcher"`). EVENT channel.
   */
  "session.deliver": SessionDeliverPayload
  /**
   * "Open a terminal tab running argv in task X" (`kobe plugin pane open` →
   * `tab.open` RPC → the hosting TUI opens a CommandTab). EVENT channel.
   */
  "tab.open": TabOpenPayload
  /**
   * Inverse of `tab.open`: close panes opened under `title` in task X
   * (`kobe api pane-close` → `tab.close` RPC). EVENT channel.
   */
  "tab.close": TabClosePayload
  /**
   * Rename Terminal Tab `tabId` of task X (`kobe api rename --tab` →
   * `terminalTab.rename` RPC). EVENT channel. No `requestId`, unlike
   * `tab.close`: rename is idempotent, so the CLI writes the persisted
   * snapshot itself (headless case) and both writers converge in any order.
   */
  "tab.rename": TabRenamePayload
  /**
   * Low-frequency agent lifecycle (compaction, subagent activity). Excludes
   * the tool family — that volume stays plugin-only via the PluginHost feed.
   * EVENT channel.
   */
  "engine.lifecycle": EngineLifecyclePayload
  /** One toast for attached UIs (`kobe api notify` → `notice.send`). EVENT channel. */
  "notice.event": NoticeEventPayload
  /**
   * Per-vendor quota snapshots from the daemon's usage cache, keyed by vendor
   * id; full map, republished on change. Vendors without a quota probe (or a
   * readable login) never appear. Consumers derive staleness from
   * `capturedAt`; the cache owns fetch cadence.
   */
  "usage.snapshot": {
    usage: Record<string, EngineQuotaUsage>
  }
  /**
   * Per-session context occupancy keyed `taskId::tabId` (footer `ctx 62%`).
   * Separate from `usage.snapshot` because producers and cadences differ and
   * one last-value slot per channel would clobber the other's replay. Full
   * map. A session with no reported usage never appears — the footer renders
   * nothing rather than a false zero.
   */
  "usage.context": {
    context: Record<string, EngineContextUsage>
  }
  /**
   * "Ask the human for a line of text" (`kobe api prompt`). EVENT channel;
   * answered via the `ui.promptReply` RPC.
   */
  "ui.prompt": UiPromptPayload
  /**
   * Opaque graphics for every attached GUI to write to its own tty
   * (`rove api pane-graphics` → `graphics.write`). EVENT channel.
   *
   * Unfiltered by task on purpose: a picture is addressed to a tab's cells, a
   * terminal not showing them stores the image until they appear, and one task
   * may be attached by several GUIs.
   */
  "graphics.write": GraphicsWritePayload
}

/** The `ui-prefs` channel payload — the persisted visual prefs snapshot. */
export type UiPrefsPayload = ChannelPayloads["ui-prefs"]

/** The `worktree.changes` channel payload — daemon-collected change counts. */
export type WorktreeChangesPayload = ChannelPayloads["worktree.changes"]

/** The `transcript.activity` channel payload — daemon-collected transcript facts. */
export type TranscriptActivityPayload = ChannelPayloads["transcript.activity"]

/** A push-channel name (a key of {@link ChannelPayloads}). */
export type ChannelName = keyof ChannelPayloads

/**
 * Runtime channel list (default subscribe-all, filter validation). Names live
 * in the plugin SDK contract so plugins and the daemon share one list. Both
 * directions are compile-checked: the annotation rejects an SDK name with no
 * {@link ChannelPayloads} entry; `_everyChannelListed` rejects the reverse.
 */
export const CHANNEL_NAMES: readonly ChannelName[] = DAEMON_CHANNELS

type _everyChannelListed = [ChannelName] extends [(typeof DAEMON_CHANNELS)[number]] ? true : never
const _everyChannelListed: _everyChannelListed = true
void _everyChannelListed

const CHANNEL_NAME_SET: ReadonlySet<string> = new Set<string>(CHANNEL_NAMES)

/** True for a string that names a real push channel. */
export function isChannelName(value: unknown): value is ChannelName {
  return typeof value === "string" && CHANNEL_NAME_SET.has(value)
}

/**
 * Subscribe `channels` → the filter the daemon enforces. `null` = deliver
 * everything: a missing, non-array, empty or all-unknown list gets every
 * channel (back-compat). Unknown names are dropped, never an error
 * (forward-compat). `daemon.stopping` is not a channel and always delivers
 * (server.ts).
 */
export function normalizeChannelFilter(value: unknown): ReadonlySet<ChannelName> | null {
  if (!Array.isArray(value)) return null
  const set = new Set<ChannelName>()
  for (const name of value) if (isChannelName(name)) set.add(name)
  return set.size > 0 ? set : null
}

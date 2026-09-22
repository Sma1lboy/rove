/**
 * Daemon wire protocol (v0.6): task-CRUD + subscribe, since engine sessions
 * live in hosted PTYs and the daemon is the task index's single writer.
 *
 * Compatibility POLICY lives in `protocol-compat.ts` (re-exported below); this
 * file is the wire VOCABULARY (frames, request names, task serialization).
 */

import type { ChannelName } from "./channels.ts"
import type { DaemonTask } from "./contracts.ts"
export type {
  PtyDataEventPayload,
  PtyExitEventPayload,
  PtyOpenResult,
  PtyPeekResult,
  PtySessionExit,
} from "./pty-protocol.ts"

export { attentionInboxItemKey, isAttentionInboxState } from "./contracts.ts"
export type { EngineQuotaUsage, EngineQuotaWindow } from "./contracts.ts"

export {
  CHANNEL_NAMES,
  type CellPixelSize,
  type ChannelName,
  type ChannelPayloads,
  type GraphicsWritePayload,
  type NoticeEventPayload,
  type EngineLifecyclePayload,
  type SessionDeliverPayload,
  type TabClosePayload,
  type TabOpenPayload,
  type TabRenamePayload,
  type TranscriptActivityPayload,
  type UiPrefsPayload,
  type UiPromptPayload,
  type WorktreeChangesPayload,
  isChannelName,
  normalizeChannelFilter,
} from "./channels.ts"

// Handshake policy (version range, build skew, home ownership); re-exported so
// `daemon/protocol` stays the one import.
export {
  DAEMON_PROTOCOL_VERSION,
  MIN_COMPATIBLE_PROTOCOL_VERSION,
  isDaemonVersionStale,
  isForeignDaemonHome,
  isProtocolCompatible,
} from "./protocol-compat.ts"

export type DaemonFrame =
  | { readonly type: "request"; readonly id: string; readonly name: DaemonRequestName; readonly payload?: unknown }
  | {
      readonly type: "response"
      readonly id: string
      readonly name?: string
      readonly payload?: unknown
      readonly error?: DaemonError
    }
  | { readonly type: "event"; readonly name: DaemonEventName; readonly payload: unknown }

export type DaemonRequestName =
  | "hello"
  | "daemon.status"
  | "daemon.stop"
  | "subscribe"
  | "task.list"
  | "task.get"
  | "task.create"
  | "task.rename"
  | "task.setBranch"
  | "task.observeLanguage"
  | "task.setVendor"
  // RAW engine launch command (`set-command`). The caller resolves its protocol
  // (presets live in kobe's state.json, unreadable here) and sends both.
  | "task.setCommand"
  | "task.delete"
  // Merge/squash a task's branch into its base repo. Refuses a dirty base
  // checkout; aborts on conflict, returning the conflicted files.
  | "task.land"
  // Read-only land preflight (base branch, commits ahead, refusals). Four git
  // reads — deliberately NOT in BLOCKING_RPCS.
  | "task.landPreflight"
  // Merge base INTO the worktree (behind-base chip). Never rebase: a live
  // engine may hold files open.
  | "task.syncBase"
  | "task.pin"
  | "task.move"
  | "task.status"
  // Record the brief only AFTER confirmed delivery; the engine transcript isn't
  // durable, so this copy is what survives engine/context loss.
  | "task.setPrompt"
  | "task.ensureMain"
  // Open an existing directory as a standalone `kind:"dir"` task (`kobe .`).
  | "task.openDir"
  // Scratch → project migration: repoint + clear the flag.
  | "task.adoptScratchRepo"
  | "project.forget"
  | "task.ensureWorktree"
  | "task.setActive"
  | "issue.list"
  // Repo roots the issue store holds a record for — a board section means
  // "this repo has a backlog", which the task index cannot answer.
  | "issue.repos"
  | "issue.mutate"
  | "worktree.discoverAdoptable"
  | "worktree.adopt"
  // Cross-project worktree audit: every worktree of every local saved project
  // (managed or not, linked or not) with dirty/age/remote-branch status.
  // Remove refuses a dirty worktree unless `force: true`.
  | "worktree.list"
  | "worktree.remove"
  // `kobe hook <verb>` reports a normalized activity event; folded into the
  // task's transient activity state and broadcast as `engine-state`.
  | "engine.reportEvent"
  // Guarded removal of the Inbox item at an event timestamp (dismiss/open/visit).
  | "attention.dismiss"
  | "attention.dismissRoutine"
  // Pending episodes for headless coordinators: the `attention.inbox` channel
  // only reaches an ATTACHED GUI.
  | "attention.list"
  // Plugin-written task-row tokens (docs/PLUGIN-AUTHORING.md § Task-row
  // tokens). In-memory, TTL-bounded, broadcast on `task.tokens`.
  | "task.rowToken"
  // Legacy alias for resolving the exact item; `at` guards stale clients.
  | "attention.read"
  // Scheduled Automations (docs/design/automations.md): CRUD + manual trigger;
  // the sweep itself is internal.
  | "automation.list"
  | "automation.create"
  | "automation.update"
  | "automation.delete"
  | "automation.runs"
  | "automation.runNow"
  // GitHub issues via `gh` (docs/design/work-items.md): READ-ONLY, plus start a
  // task on one. Never mirrored into the local issue store.
  | "workitem.list"
  | "workitem.start"
  // Dispatcher messenger (docs/design/dispatcher.md): publish `session.deliver`
  // for a task's live session; the hosting front-end delivers.
  | "session.deliver"
  // A PR's FAILING check logs, once per human click. Never polled: it
  // downloads whole job logs.
  | "pr.failingChecks"
  // Read one task's recent engine lifecycle events (the TUI event feed).
  | "task.recentEvents"
  // Turn store read side; written only by hook ingest on `turn-complete`.
  | "agentTurn.list"
  // `kobe api inspect`: RAW activity-registry entries (probe vendor, armed
  // watchdogs) beyond the engine-state payload. Read-only.
  | "debug.inspect"
  // TUI-originated product events (file/task/project opens) → plugin hooks.
  | "ui.reportEvent"
  // Plugin input dialog (`kobe api prompt`): blocks until an attached TUI
  // answers via `ui.promptReply` or the broker times out.
  | "ui.prompt"
  | "ui.promptReply"
  // Plugin panes: publish `tab.open` so the hosting TUI runs argv in a tab.
  // Same trust boundary as `pty.open`; the daemon only validates + publishes.
  | "tab.open"
  // Publish `tab.close`: the hosting TUI closes the panes it opened under a title.
  | "tab.close"
  // Ask an attached TUI to run its ctrl+w close path and ack ownership; the
  // CLI falls back to the standalone PTY Host when nobody confirms.
  | "terminalTab.close"
  | "terminalTab.closeReply"
  // Broadcast on `tab.rename` (`kobe api rename --tab`). No reply: rename is
  // idempotent and the CLI also writes the persisted snapshot.
  | "terminalTab.rename"
  // Toast to every attached UI on `notice.event` (`kobe api notify`).
  | "notice.send"
  // OPAQUE graphics bytes for each attached GUI's tty (`kobe api pane-graphics`),
  // on `graphics.write`. The daemon allocates the image id (a pane can't: the id
  // space is the terminal's) and parses nothing.
  | "graphics.write"
  // Field note (docs/design/dispatcher.md): APPEND a one-line gotcha to the
  // per-repo notes store, then forward it to the repo's main session over
  // `session.deliver`. `note.list` seeds each fresh worktree session.
  | "note.file"
  | "note.list"
  // The newest notes are injected into every fresh session, so a stale one
  // must be removable.
  | "note.delete"
  // Hosted PTYs (v4), served by the standalone PTY HOST (`kobe pty-host`, own
  // socket, `pty-server.ts`), NOT the daemon: the daemon restarts routinely.
  // Same frame grammar and client class. The host owns the PTY child + a byte
  // ring buffer per session key and answers only OSC 10/11 color queries (so
  // headless children see a palette); the TUI keeps VT emulation. `pty.open`
  // attaches the CONNECTION (spawn on first open, ring replay on reattach);
  // `pty.data` frames go only to attached connections.
  | "pty.open"
  | "pty.write"
  | "pty.resize"
  | "pty.kill"
  | "pty.detach"
  | "pty.list"
  // Re-key a running session (`{from, to}` → `{renamed: boolean}`) for the
  // scratch fold; the child keeps running. Older hosts reject it, so callers
  // must check `renamed`: if false, fold only the tab record and the session
  // stays under its old key until scratch teardown.
  | "pty.rename"
  // Ring-buffer peek (no attach/spawn/resize) for `kobe api read-output`'s
  // terminal fallback. Older hosts reject it; callers treat that as no data.
  | "pty.peek"
  // Pre-spawn an idle, rc-initialized shell for a cwd; the next bare-shell
  // `pty.open` there adopts it. Best-effort; older hosts reject the verb.
  | "pty.warm"

/**
 * Verbs whose CONTRACT is to block, so the client puts no wedge deadline on them.
 *
 * Blowing the client's 20s deadline rejects with `RpcTimeoutError`,
 * force-disconnects and drops every channel subscription on the TUI's
 * connection — right for a wedged daemon, wrong for a slow `task.land` on a
 * large repo. These verbs wait on a human, shell out on a user-sized repo or
 * `gh`, or deliver serially into PTYs; the DAEMON owns settlement.
 *
 * Lives here, next to {@link DaemonRequestName}, because the client must not
 * import the handler registry (it would drag every daemon module into the
 * CLI). Registry entries declare `blocking: true`;
 * `test/daemon/rpc-deadline.test.ts` fails if the two drift.
 */
export const BLOCKING_RPCS: ReadonlySet<DaemonRequestName> = new Set<DaemonRequestName>([
  // Blocks on a human answering the TUI dialog (default 120s, max 600s).
  "ui.prompt",
  // Merge/squash plus optional worktree removal, on a repo of any size.
  "task.land",
  // `gh` lookup (its own 20s subprocess budget) then task/worktree/engine setup.
  "workitem.start",
  // Precheck subprocess, then a full session start.
  "automation.runNow",
  // Worktree work and forge lookups (ls-remote, gh PR states) — minute-scale.
  "task.ensureWorktree",
  "task.ensureMain",
  "worktree.discoverAdoptable",
  "worktree.adopt",
  "worktree.list",
  "worktree.remove",
])

/**
 * WHO is subscribing, so the refcounted lazy shutdown counts only real attaches.
 *
 * - `gui` — a user-facing front-end (the `kobe` TUI, or the deprecated outer
 *   monitor); HOLDS the daemon alive.
 * - `pane` — a helper pane (Tasks pane, Ops, settings/new-task windows,
 *   transient `kobe api` pokes) that only RECEIVES channels. Panes outlive the
 *   attach, so counting them would pin the daemon open forever.
 *
 * Default is `pane`, so a client that forgets to declare can't pin the daemon.
 */
export type SubscribeRole = "gui" | "pane"

/**
 * Every {@link ChannelName}, plus `daemon.stopping` (NOT a channel: no
 * last-value, never replayed to a late subscriber) and `pty.data`/`pty.exit`
 * (v4) — also not channels: written only to attached connections, an ordered
 * byte stream (drop/replay corrupts VT state), never via the event bus.
 */
export type DaemonEventName = ChannelName | "daemon.stopping" | "pty.data" | "pty.exit"

/**
 * WHY a daemon is going away, on the `daemon.stopping` frame (v5). Clients only
 * wait out `idle`/`socket-lost`/`stop`; `restart` replaces the CODE, so an
 * attached TUI can offer a refresh at once instead of after reconnect + `hello`.
 * `stop` is the default, so an unlabelled stop never claims to be a restart.
 */
export type DaemonStopReason = "restart" | "stop" | "idle" | "socket-lost"

/**
 * The `daemon.stopping` frame's payload. Every field optional: a v4 daemon
 * broadcasts `{}`, and a v4 client ignores what it does not know — so this
 * shape may only ever GROW optional fields.
 */
export interface DaemonStoppingPayload {
  readonly reason?: DaemonStopReason
  /** Outgoing build version, comparable without waiting for the next `hello`. */
  readonly kobeVersion?: string
}

/** Unknown/absent → `undefined` (an older daemon, or a reason this build doesn't know). */
export function parseDaemonStopReason(value: unknown): DaemonStopReason | undefined {
  return value === "restart" || value === "stop" || value === "idle" || value === "socket-lost" ? value : undefined
}

export interface DaemonError {
  readonly message: string
  readonly name?: string
}

export interface SerializedTask {
  readonly id: string
  readonly title: string
  readonly repo: string
  readonly branch: string
  readonly worktreePath: string
  readonly kind: "main" | "task" | "dir"
  /** Scratch shell task — Scratch-section row, cleared on adopt/rename. */
  readonly scratch?: boolean
  /** A routine's standing session — folded behind the sidebar's routine count row. */
  readonly routine?: DaemonTask["routine"]
  readonly status: DaemonTask["status"]
  readonly pinned: boolean
  readonly vendor?: DaemonTask["vendor"]
  /** Raw engine launch command as given to `add --command` / `set-command`. */
  readonly command?: DaemonTask["command"]
  readonly prStatus?: DaemonTask["prStatus"]
  /** Engine reasoning/effort level, when the vendor supports one. */
  readonly modelEffort?: string
  /** Model pinned on the engine, in its own spelling. */
  readonly model?: string
  /** Auto-routing tier the engine fields were filled from, when one was. */
  readonly tier?: string
  /** Fan-out round marker shared by the siblings of one fan-out call. */
  readonly groupId?: string
  /** Language this task's user writes in, observed from their own prompts. */
  readonly observedLanguage?: DaemonTask["observedLanguage"]
  /** Durable daemon-owned background deletion state. */
  readonly deletion?: DaemonTask["deletion"]
  /** Durable rate-limit auto-resume schedule. */
  readonly quotaResume?: DaemonTask["quotaResume"]
  readonly linkedWorkItem?: DaemonTask["linkedWorkItem"]
  /** The kobe session (task + tab) that dispatched this task's creation. */
  readonly dispatcher?: DaemonTask["dispatcher"]
  /** The task brief: the full delivered `add --prompt` text (never truncated). */
  readonly prompt?: DaemonTask["prompt"]
  /** The recorded fork point (`add --base-branch`) branch signals measure against. */
  readonly baseRef?: DaemonTask["baseRef"]
  /** Caller-chosen worktree directory name (`add --worktree-name`). */
  readonly worktreeName?: DaemonTask["worktreeName"]
  /** The worker's own outcome claim (`set-status --report-*`) — a CLAIM,
   *  where `prStatus` is the daemon's own observation of the forge. */
  readonly report?: DaemonTask["report"]
  /**
   * Which machine served this task. NEVER set by a daemon: the merging client
   * stamps it after deserializing. Declared here so CLI and client types agree
   * without casts.
   */
  readonly origin?: { readonly machineId: string; readonly hostLabel: string }
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Empty-title fallback (scratch tasks mint no auto-name), filled on the wire
 * upstream of every consumer so none renders a blank row. The STORED title
 * stays empty. No truncation: consumers clip, agents want the full path.
 */
export function displayTaskTitle(task: Pick<DaemonTask, "title" | "branch" | "worktreePath" | "repo">): string {
  return task.title || task.branch || task.worktreePath || task.repo || "scratch"
}

export function serializeTask(task: DaemonTask): SerializedTask {
  return {
    id: task.id,
    title: displayTaskTitle(task),
    repo: task.repo,
    branch: task.branch,
    worktreePath: task.worktreePath,
    kind: task.kind ?? "task",
    ...(task.scratch ? { scratch: true } : {}),
    ...(task.routine ? { routine: task.routine } : {}),
    status: task.status,
    pinned: task.pinned ?? false,
    vendor: task.vendor,
    command: task.command,
    prStatus: task.prStatus,
    modelEffort: task.modelEffort,
    model: task.model,
    tier: task.tier,
    groupId: task.groupId,
    observedLanguage: task.observedLanguage,
    deletion: task.deletion,
    quotaResume: task.quotaResume,
    linkedWorkItem: task.linkedWorkItem,
    dispatcher: task.dispatcher,
    prompt: task.prompt,
    baseRef: task.baseRef,
    worktreeName: task.worktreeName,
    report: task.report,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

export function frameToLine(frame: DaemonFrame): string {
  return `${JSON.stringify(frame)}\n`
}

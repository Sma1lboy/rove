/**
 * Daemon wire protocol (v0.6).
 *
 * Engine sessions live in hosted PTYs, so the daemon's only job is to be
 * a single writer for the task index: the protocol is a task-CRUD +
 * subscribe shape.
 *
 * Two questions live under this name: the compatibility POLICY (can these two
 * builds talk — `protocol-compat.ts`, re-exported below) and the wire
 * VOCABULARY (frames, request names, task serialization — this file).
 */

import type { ChannelName } from "./channels.ts"
import type { DaemonTask } from "./contracts.ts"
import type {
  PtyDataEventPayload,
  PtyExitEventPayload,
  PtyOpenResult,
  PtyPeekResult,
  PtySessionExit,
} from "./pty-protocol.ts"
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
  type ChannelName,
  type ChannelPayloads,
  type NoticeEventPayload,
  type EngineLifecyclePayload,
  type SessionDeliverPayload,
  type TabClosePayload,
  type TabOpenPayload,
  type TranscriptActivityPayload,
  type UiPrefsPayload,
  type UiPromptPayload,
  type WorktreeChangesPayload,
  isChannelName,
  normalizeChannelFilter,
} from "./channels.ts"

// Handshake compatibility policy — version range, build skew, home ownership.
// Lives in protocol-compat.ts (it changes on a different clock than the wire
// vocabulary below); re-exported so `daemon/protocol` stays the one import.
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
  // Set a task's RAW engine launch command (the dispatch face's
  // `set-command`). The caller resolves the command's protocol — engine
  // presets live in kobe's state.json, which the daemon cannot read — and
  // sends both, so the record stays self-consistent.
  | "task.setCommand"
  | "task.delete"
  // Land a task's branch back into its base repo (merge/squash). The last step
  // of the worktree→engine→branch lifecycle that had no product path; refuses a
  // dirty base checkout and aborts on conflict, returning the conflicted files.
  | "task.land"
  // The read-only half of a land: which branch the base checkout is on, how
  // many commits ahead the task branch is, whether either refuses the merge.
  // Four git reads — deliberately NOT in BLOCKING_RPCS.
  | "task.landPreflight"
  // Merge a task's base branch INTO its worktree — the answer to the sidebar's
  // behind-base drift chip. Merge, never rebase: the worktree may have a live
  // engine holding files open.
  | "task.syncBase"
  | "task.pin"
  | "task.move"
  | "task.status"
  // Record the task brief on the task row AFTER the prompt was confirmed
  // delivered into the engine — the engine's own transcript is not durable,
  // and this field is the copy that survives a dead engine/context loss.
  // Deliberately NOT web-exposed: the browser has no reason to write another
  // task's brief, and the web allowlist is a security contract.
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
  | "issue.mutate"
  | "worktree.discoverAdoptable"
  | "worktree.adopt"
  // Cross-project worktree audit (the standalone worktree-management TUI
  // page): list every worktree of every local saved project (kobe-managed
  // or not, linked to a task or not) with dirty/age/remote-branch status,
  // and remove one (refuses a dirty worktree unless `force: true`, same
  // safety property `GitWorktreeManager.remove` always had).
  | "worktree.list"
  | "worktree.remove"
  // Engine HOOK ingest (KOB): a `kobe hook <verb>` process reports a
  // normalized engine activity event for a task; the daemon folds it into
  // the task's transient activity state and broadcasts `engine-state`.
  | "engine.reportEvent"
  // Remove the durable Inbox item at the supplied event timestamp. Explicit
  // removal, opening, and visiting the target all use this guarded operation.
  | "attention.dismiss"
  // Legacy alias for resolving the exact item; `at` guards stale clients.
  | "attention.read"
  // Scheduled Automations (docs/design/automations.md): CRUD over the
  // daemon-owned schedule store, plus a manual trigger. The sweep itself is
  // internal — these only shape what it will find on its next tick.
  | "automation.list"
  | "automation.create"
  | "automation.update"
  | "automation.delete"
  | "automation.runs"
  | "automation.runNow"
  // External tracker work items (docs/design/work-items.md): a READ-ONLY view
  // of GitHub issues via the `gh` CLI, plus one action — start a task on one.
  // Never mirrored into the local issue store.
  | "workitem.list"
  | "workitem.start"
  // Dispatcher messenger (docs/design/dispatcher.md): publish a
  // `session.deliver` channel event addressed to a task's live session.
  // The daemon only routes; the front-end hosting that session delivers.
  | "session.deliver"
  // On-demand read of a PR's FAILING check logs (the sidebar's "Fix failing
  // checks"). Never polled: it downloads whole job logs, so it runs once per
  // human click and leaves the pr-status poller's cadence alone.
  | "pr.failingChecks"
  // Read one task's recent engine lifecycle events (the TUI event feed).
  | "task.recentEvents"
  // Per-turn agent telemetry: the durable turn store's read side.
  // Written only by the hook-driven ingest on `turn-complete`.
  | "agentTurn.list"
  // Production diagnostics (`kobe api inspect`): the activity registry's RAW
  // task/tab entries — probe vendor, armed watchdogs — beyond what the
  // engine-state wire payload carries. Read-only.
  | "debug.inspect"
  // TUI-originated product events (file/task/project opens) → plugin hooks.
  | "ui.reportEvent"
  // Host-provided input dialog (plugins → `kobe api prompt`): `ui.prompt`
  // blocks until an attached TUI answers via `ui.promptReply` or the
  // broker times the request out.
  | "ui.prompt"
  | "ui.promptReply"
  // Plugin panes: publish a `tab.open` channel event asking the TUI hosting
  // the task to open a terminal tab running argv. Same trust boundary as
  // `pty.open`; the daemon only validates + publishes.
  | "tab.open"
  // The inverse: publish a `tab.close` channel event asking the TUI hosting
  // the task to close the panes it opened under a title.
  | "tab.close"
  // Exact Terminal Tab lifecycle: ask an attached TUI to run its normal
  // ctrl+w close path, then acknowledge whether it owned the tab. The CLI
  // falls back to the standalone PTY Host when nobody confirms.
  | "terminalTab.close"
  | "terminalTab.closeReply"
  // Broadcast one toast to every attached UI over the `notice.event`
  // channel (`kobe api notify`). The daemon only validates + publishes.
  | "notice.send"
  // Field note (docs/design/dispatcher.md): a worktree session files a
  // one-line resolved gotcha. The daemon APPENDS it to the durable per-repo
  // notes store, then forwards it to the repo's dispatcher seat (the main
  // session) over `session.deliver`. `note.list` reads the store back —
  // the launch path seeds each fresh worktree session with it.
  | "note.file"
  | "note.list"
  // Hosted PTYs (v4) — persistent out-of-process terminals for embedded
  // engine sessions. Served by the standalone PTY HOST process
  // (`kobe pty-host`, its own socket — see `pty-server.ts`), NOT by the
  // daemon: the daemon restarts routinely, so the pty host must outlive it.
  // Same frame grammar, so the same client class speaks both. The
  // host owns the raw PTY child + a byte ring buffer per session key; the
  // TUI keeps VT emulation (xterm-headless) local. The host answers only
  // OSC 10/11 default-color queries so headless children see a terminal
  // palette even while no emulator is attached. `pty.open` attaches
  // the calling CONNECTION (spawning on first open, replaying the ring
  // buffer on reattach); output streams back as targeted `pty.data` event
  // frames written only to attached connections. `pty.sweep` is the
  // daemon→host janitor call: kill sessions whose task was deleted.
  | "pty.open"
  | "pty.write"
  | "pty.resize"
  | "pty.kill"
  | "pty.detach"
  | "pty.list"
  | "pty.sweep"
  // Re-key a running session (`{from, to}` → `{renamed: boolean}`) — the
  // scratch-fold move: the child keeps running, only its ownership label
  // changes so sweeps and future attaches see it under the adopting task's
  // tab key. Older hosts reject the verb; callers treat that as "fold the
  // tab record only, session stays under its original key until the scratch
  // task's teardown" — hence they must check `renamed`.
  | "pty.rename"
  // Read-only ring-buffer peek for one session key: no attach, no spawn,
  // no resize — the observation primitive `kobe api read-output` uses for
  // its bounded terminal fallback. Older hosts reject the verb; callers
  // treat that as "no terminal data".
  | "pty.peek"
  // Pre-spawn one idle shell for a cwd so the next `pty.open` whose spec
  // is that bare shell adopts it (already rc-initialized) instead of
  // paying shell startup. Best-effort; older hosts reject the verb.
  | "pty.warm"
  // Deferred prompts: the delivery gate accepted a prompt
  // it could not paste (composer busy) into daemon ownership. New clients use
  // `fileIfVacant`, whose distinct name makes old replace-on-file daemons fail
  // loud. `release` and `flush` claim records before exact-tab delivery;
  // `get`/`resolve` remain only for loud legacy skew and pre-restart cleanup.
  | "deferredPrompt.file"
  | "deferredPrompt.fileIfVacant"
  | "deferredPrompt.get"
  | "deferredPrompt.resolve"
  | "deferredPrompt.release"
  | "deferredPrompt.discardTab"
  | "deferredPrompt.flush"

/**
 * Verbs whose CONTRACT is to block, so the client must not put a wedge
 * deadline on them.
 *
 * The socket client gives every request a 20s deadline, and blowing it is not
 * a plain failure: it rejects with `RpcTimeoutError("… daemon wedged?")`, then
 * force-disconnects and emits a lifecycle `close`, dropping every channel
 * subscription on the TUI's long-lived connection. That is the right move for
 * a genuinely wedged daemon and the wrong one for a verb that is simply still
 * working — a `task.land` on a large repo would put the whole workspace into
 * the reconnect path while the daemon is perfectly healthy.
 *
 * Each name here either waits on a human (`ui.prompt`), shells out on a
 * user-sized repo or through `gh`, or delivers serially into PTYs. For all of
 * them the DAEMON owns settlement, so the client's timer buys nothing.
 *
 * This set lives in the wire contract, next to {@link DaemonRequestName},
 * because both the client (which must not import the handler registry — that
 * would drag every daemon module into the CLI) and the registry need it. The
 * registry entry is where a verb DECLARES it (`blocking: true` beside
 * `web: true`), and `test/daemon/rpc-deadline.test.ts` fails if the two drift.
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
  // One PTY delivery per queued record, serially.
  "deferredPrompt.flush",
  "deferredPrompt.release",
  // Worktree work and forge lookups (ls-remote, gh PR states) — minute-scale.
  "task.ensureWorktree",
  "task.ensureMain",
  "worktree.discoverAdoptable",
  "worktree.adopt",
  "worktree.list",
  "worktree.remove",
])

/**
 * Subscribe role (KOB) — distinguishes WHO is subscribing, so the daemon's
 * refcounted lazy-shutdown counts only real front-end attaches.
 *
 * - `gui`  — a user-facing front-end attach (the `kobe` TUI process, or the
 *   deprecated outer monitor). Its lifetime equals "a human is looking at
 *   kobe", so it HOLDS the daemon alive.
 * - `pane` — a kobe-spawned helper pane (Tasks pane, Ops, settings/new-task
 *   windows, transient `kobe api` pokes). It subscribes to RECEIVE push
 *   channels but must NOT keep the daemon alive: these panes outlive the
 *   attach (the front-end session persists after the user quits), so counting
 *   them wedges the daemon open forever — N Terminal Tabs means N Tasks panes,
 *   and the count never reaches 0 on quit.
 *
 * Default is `pane`: a subscriber that forgets to declare a role is the safe
 * non-holding kind, so a future client can never accidentally pin the daemon.
 */
export type SubscribeRole = "gui" | "pane"

/**
 * Event-frame names: every {@link ChannelName}, plus `daemon.stopping` — a
 * lifecycle signal that is deliberately NOT a channel (it has no last-value
 * and must never be replayed to a late subscriber as if current) — plus the
 * targeted PTY stream frames (`pty.data` / `pty.exit`, v4). PTY frames are
 * also NOT channels: they are written only to connections attached to that
 * PTY session, carry an ordered byte stream (dropping or replaying one
 * corrupts the client's VT state), and never pass through the event bus.
 */
export type DaemonEventName = ChannelName | "daemon.stopping" | "pty.data" | "pty.exit"

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
  /** Standing session of a routine — folded behind the sidebar's
   *  routine count row instead of rendering as a loose task. */
  readonly routine?: DaemonTask["routine"]
  readonly status: DaemonTask["status"]
  readonly pinned: boolean
  readonly vendor?: DaemonTask["vendor"]
  /** Raw engine launch command as given to `add --command` / `set-command`. */
  readonly command?: DaemonTask["command"]
  readonly prStatus?: DaemonTask["prStatus"]
  /** Engine reasoning/effort level, when the vendor supports one. */
  readonly modelEffort?: string
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
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Display fallback for an empty task title: a scratch task mints
 * no auto-name, so the wire fills branch → directory → "scratch" HERE — one
 * spot upstream of every consumer (TUI task channel, web board/kanban,
 * `api list`/`get-task`, notification copy), so none can render a blank row.
 * The STORED title stays empty; only the serialized view is filled. No
 * truncation: consumers clip visually, and agents reading the JSON want the
 * full path.
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
    groupId: task.groupId,
    observedLanguage: task.observedLanguage,
    deletion: task.deletion,
    quotaResume: task.quotaResume,
    linkedWorkItem: task.linkedWorkItem,
    dispatcher: task.dispatcher,
    prompt: task.prompt,
    baseRef: task.baseRef,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

export function frameToLine(frame: DaemonFrame): string {
  return `${JSON.stringify(frame)}\n`
}

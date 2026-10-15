/**
 * Wire contract between rove-bridge and the iOS client (docs/IOS.md).
 * JSON text frames over one authenticated WebSocket:
 *   request  {id, op, args}
 *   response {id, ok: true, result} | {id, ok: false, error: {code, message}}
 *   push     {event, data}
 * The op set is a closed allowlist: anything else is `UNKNOWN_OP`, so the
 * bridge never becomes a generic daemon passthrough.
 */

export const BRIDGE_PROTOCOL_VERSION = 1

export const OPS = [
  "hello",
  "tasks.subscribe",
  "tasks.list",
  "engines.list",
  "repos.list",
  "task.create",
  "task.delete",
  "task.land",
  "task.tabs",
  "tab.new",
  "tab.close",
  "term.attach",
  "term.input",
  "term.resize",
  "term.detach",
  "diff.files",
  "diff.file",
  "attention.dismiss",
] as const

export type Op = (typeof OPS)[number]

export type TaskGroup = "waiting-on-you" | "landing" | "ready-for-review" | "working" | "idle" | "unknown"

export type PrChipKind = "conflict" | "failing" | "passing"

export type RowChanges =
  | { readonly added: number; readonly deleted: number; readonly ahead?: number; readonly behind?: number }
  | { readonly unreadable: true }

export interface RowTokenChip {
  readonly text: string
  readonly tone?: string
  readonly source: string
  /** ms epoch; the phone filters on display. */
  readonly expiresAt: number
}

export interface TaskRow {
  readonly id: string
  readonly title: string
  readonly branch: string
  readonly repo: string
  readonly kind: string
  readonly status: string
  readonly group: TaskGroup
  readonly rank: number
  /**
   * `forMs` = time in `state`, for display (immune to phone/Mac clock skew).
   * `since` (optional, additive) = when that episode began on the bridge's clock. Clients
   * never need it — they age `forMs` locally — but the feed keys on it, so a new episode in
   * the same state (turn ends, next starts) still pushes a fresh `forMs`.
   */
  readonly activity: { readonly state: string; readonly forMs: number; readonly since?: number } | null
  /** Display name comes from the engine registry; the app never hardcodes vendors. */
  readonly engine: { readonly id: string | null; readonly name: string } | null
  readonly pr: {
    readonly number?: number
    readonly url?: string
    readonly lifecycle: string
    readonly checkState: string
    readonly reviewDecision?: string
    readonly mergeable?: string
  } | null
  /** The worker's own claim of what it delivered, not a verification. */
  readonly report: { readonly summary: string; readonly at: string } | null
  readonly deleting: boolean
  /** Additive row fields (all optional: absent = not collected / not known). */
  readonly pinned?: boolean
  /** The standing session of a scheduled routine; clients fold these behind a per-project count row. */
  readonly routine?: boolean
  /** Index in the daemon's own task list: the manual ("default") order. */
  readonly order?: number
  readonly createdAt?: string
  readonly updatedAt?: string
  /** Uncommitted counts from the daemon's `worktree.changes` push; `unreadable` = tracked but git could not be read. Absent = not collected, never zeros. */
  readonly changes?: RowChanges
  /** Live (unexpired when read) plugin tokens. */
  readonly rowTokens?: readonly RowTokenChip[]
  /** The sidebar's one PR chip (row-chips.ts rules); `null` = none. */
  readonly prChip?: PrChipKind | null
  /** The forge was unreachable on the last poll, so `prChip` is the last good value. */
  readonly prChipStale?: boolean
  /** The task has a stored brief (`task.prompt`), so "Run again" has something to run. */
  readonly hasPrompt?: boolean
  /** Set on a row another registered machine's daemon served (`rove machine add`); absent = this Mac's. `stale` = that machine is unreachable and this is its last known state. */
  readonly machine?: MachineTag
}

export interface MachineTag {
  readonly id: string
  readonly label: string
  readonly stale?: boolean
}

export interface AttentionRow {
  readonly taskId: string | null
  readonly tabId: string | null
  readonly state: string
  readonly unread: boolean
  readonly at: number
  /** Rate-limited tasks: ISO time the daemon will auto-resume the engine (`quotaResume`). Optional. */
  readonly resumeAt?: string
  /** Routine episodes: the routine's name (the subject is a schedule, not a task). Optional. */
  readonly label?: string
  /** Routine episodes: the schedule's id; `attention.dismissRoutine` clears the episode by it and the Routines page lands on that routine. Optional. */
  readonly automationId?: string
}

export interface TasksPayload {
  readonly tasks: readonly TaskRow[]
  readonly attention: readonly AttentionRow[]
}

export interface TabRow {
  readonly id: string
  readonly kind: string
  readonly title: string | null
  readonly engineName: string | null
  /** The engine actually running in the tab (the pty's foreground process), or null when unknown: the TUI's two-row caption. */
  readonly liveEngine?: string | null
  readonly alive: boolean | null
  readonly engineAlive: boolean | null
  /** Present while the tab is split: the pane layout (`rove api get-task` `.tabs[].split`). Absent = one pane. */
  readonly split?: SplitView
  /** A viewport tab: the task whose session it shows (`rove api get-task` `.tabs[].viewOf`). Absent = its own session. */
  readonly viewOf?: string
}

/** A split layout: panes are leaves named `leaf-N`; `leaf-1` is the tab's own process, the rest are hosted login shells. */
export type SplitNodeView =
  | { readonly kind: "leaf"; readonly id: string; readonly title: string | null; readonly own: boolean }
  | { readonly kind: "group"; readonly orientation: "row" | "column"; readonly children: readonly SplitNodeView[] }

export interface SplitView {
  readonly root: SplitNodeView
  readonly activeLeafId: string
}

export interface DiffFileRow {
  readonly path: string
  readonly status: string
  readonly added: number | null
  readonly deleted: number | null
  readonly scope: "branch" | "working"
}

export interface Request {
  readonly id: number
  /** A core `Op`, or an area op the server's allowlist names. */
  readonly op: string
  readonly args: Readonly<Record<string, unknown>>
}

export function isCoreOp(op: string): op is Op {
  return (OPS as readonly string[]).includes(op)
}

/** A refusal the client can branch on; `code` is stable, `message` is prose. */
export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "BridgeError"
  }
}

/**
 * Parse one inbound frame. Throws {@link BridgeError} for malformed frames;
 * the caller answers with the frame's `id` when one could be read. `known` is the
 * full allowlist (core ops plus registered area ops).
 */
export function parseRequest(raw: string, known: (op: string) => boolean = isCoreOp): Request {
  let frame: unknown
  try {
    frame = JSON.parse(raw)
  } catch {
    throw new BridgeError("BAD_FRAME", "frame is not JSON")
  }
  if (!frame || typeof frame !== "object" || Array.isArray(frame))
    throw new BridgeError("BAD_FRAME", "frame is not an object")
  const { id, op, args } = frame as Record<string, unknown>
  if (typeof id !== "number" || !Number.isSafeInteger(id))
    throw new BridgeError("BAD_FRAME", "frame needs an integer id")
  if (typeof op !== "string" || !known(op)) {
    throw Object.assign(new BridgeError("UNKNOWN_OP", `unknown op: ${String(op)}`), { requestId: id })
  }
  if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
    throw Object.assign(new BridgeError("BAD_ARGS", "args must be an object"), { requestId: id })
  }
  return { id, op, args: (args ?? {}) as Record<string, unknown> }
}

/** The id of a frame that failed {@link parseRequest} after its id was read. */
export function requestIdOf(err: unknown): number | null {
  const id = err && typeof err === "object" && "requestId" in err ? err.requestId : null
  return typeof id === "number" ? id : null
}

export function str(args: Readonly<Record<string, unknown>>, name: string): string {
  const v = args[name]
  if (typeof v !== "string" || v.length === 0) throw new BridgeError("BAD_ARGS", `${name} must be a non-empty string`)
  return v
}

export function optStr(args: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const v = args[name]
  if (v === undefined || v === null || v === "") return undefined
  if (typeof v !== "string") throw new BridgeError("BAD_ARGS", `${name} must be a string`)
  return v
}

export function optInt(
  args: Readonly<Record<string, unknown>>,
  name: string,
  min: number,
  max: number,
): number | undefined {
  const v = args[name]
  if (v === undefined || v === null) return undefined
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new BridgeError("BAD_ARGS", `${name} must be an integer in ${min}..${max}`)
  }
  return v
}

export function optBool(args: Readonly<Record<string, unknown>>, name: string): boolean {
  const v = args[name]
  if (v === undefined || v === null) return false
  if (typeof v !== "boolean") throw new BridgeError("BAD_ARGS", `${name} must be a boolean`)
  return v
}

export function responseOk(id: number, result: unknown): string {
  return JSON.stringify({ id, ok: true, result: result ?? {} })
}

export function responseError(id: number | null, code: string, message: string): string {
  return JSON.stringify({ id, ok: false, error: { code, message } })
}

export function pushEvent(event: string, data: unknown): string {
  return JSON.stringify({ event, data })
}

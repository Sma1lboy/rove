/**
 * What the world draws: the stations (one per task), their agents (one per open session), and the
 * beats (one per tool call). Nothing here invents activity — everything comes from the daemon the
 * page already drives. The one gap is tool calls: the bridge pushes task rows, not transcript
 * events, so an active task's recent history is polled through `output.read` and diffed by call id.
 * That poll is the known ceiling (two seconds per active task, none for an idle one); the upgrade
 * path is a daemon-side tool-event push, which would make this a subscription instead.
 *
 * ponytail: polled beats, one `output.read` per active task per 2s. Swap for a daemon push when
 * several dozen tasks run at once.
 */

import type { TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import type { BridgeClient } from "../bridge.ts"
import type { RawMessage, ReadReply } from "../transcript-data.ts"
import { type Beat, BeatLog } from "./beats.ts"

export interface WorldAgent {
  readonly id: string
  /** The engine's display name, as the row carries it; "" for a shell. */
  readonly engine: string
  readonly alive: boolean
}

export interface WorldStation {
  readonly id: string
  readonly label: string
  /** The task's own hue, from its id: stable across reloads and engines. */
  readonly hue: number
  readonly status: "busy" | "attention" | "running" | "needs-input" | "unseen" | "idle"
  readonly since: number
  readonly agents: readonly WorldAgent[]
  readonly calls: number
}

/** A task's station, as the scene wants it. */
function station(row: TaskRow, tabs: readonly TabRow[], calls: number): WorldStation {
  return {
    id: row.id,
    label: row.label || row.title || row.branch,
    hue: hueOf(row.id),
    status: (row.rowStatus?.kind ?? (row.activity?.state === "running" ? "running" : "idle")) as WorldStation["status"],
    since: row.rowStatus?.since ?? 0,
    agents: tabs.map((tab) => ({
      id: tab.id,
      engine: tab.engineName ?? row.engine?.name ?? "",
      alive: tab.alive ?? tab.status?.alive ?? false,
    })),
    calls,
  }
}

/** The world's accent hues: warm industrial and cold instrument, never a random neon. */
const HUES = [22, 8, 42, 160, 192, 205, 96, 268, 318, 146]

/** A stable hue per task id: the same task keeps its colour in every session. */
export function hueOf(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return HUES[Math.abs(hash) % HUES.length]
}

/** Every live local task as a station, in the rail's order. */
export function worldStations(
  payload: TasksPayload | null,
  tabs: Readonly<Record<string, readonly TabRow[]>>,
  calls: ReadonlyMap<string, number> = new Map(),
): readonly WorldStation[] {
  const rows = payload?.tasks.filter((row) => !row.deleting) ?? []
  return rows.slice(0, 12).map((row) => station(row, tabs[row.id] ?? [], calls.get(row.id) ?? 0))
}

/** A task worth polling: one whose engine is working right now. */
export function isWorking(row: TaskRow): boolean {
  return row.rowStatus?.kind === "running" || row.activity?.state === "running"
}

const POLL_MS = 2000
const POLL_LIMIT = 4
const MAX_POLLED = 6

/**
 * Polls the working tasks' recent history and turns each new tool call into a beat. One poll per
 * task in flight at a time; a hidden page polls nothing.
 */
export class WorldFeed {
  readonly log = new BeatLog()
  private readonly calls = new Map<string, number>()
  private readonly lastReadAt = new Map<string, number>()
  private readonly inflight = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private sink: ((beat: Beat, taskId: string) => void) | null = null
  /** Timestamps of the beats in the last 15 s, for the rate graph. */
  private recent: number[] = []

  constructor(
    private readonly client: BridgeClient,
    private readonly tasks: () => readonly TaskRow[],
    private readonly selected: () => string | null = () => null,
  ) {}

  start(onBeat: (beat: Beat, taskId: string) => void): void {
    this.sink = onBeat
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), POLL_MS)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.sink = null
  }

  /** Calls seen per task since the page opened. */
  get counts(): ReadonlyMap<string, number> {
    return this.calls
  }

  /** Beats in the last 15 s. */
  get rate(): number {
    const cutoff = Date.now() - 15_000
    this.recent = this.recent.filter((at) => at >= cutoff)
    return this.recent.length
  }

  private tick(): void {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return
    const rows = this.tasks()
    const selected = this.selected()
    const picked: TaskRow[] = []
    for (const row of rows) {
      if (!isWorking(row) || this.inflight.has(row.id)) continue
      if (row.id === selected) picked.unshift(row)
      else picked.push(row)
    }
    for (const row of picked.slice(0, MAX_POLLED)) void this.poll(row.id)
  }

  private async poll(taskId: string): Promise<void> {
    this.inflight.add(taskId)
    try {
      const page = await this.client.request<ReadReply>("output.read", { taskId, limit: POLL_LIMIT })
      const messages: readonly RawMessage[] = page.history?.messages ?? []
      const fresh = this.log.ingest(messages, Date.now())
      if (fresh.length === 0) return
      this.calls.set(taskId, (this.calls.get(taskId) ?? 0) + fresh.length)
      for (const beat of fresh) {
        this.recent.push(beat.at)
        this.sink?.(beat, taskId)
      }
    } catch {
      // A task that cannot be read yet (no engine, a bridge mid-restart) simply has no beats.
    } finally {
      this.inflight.delete(taskId)
      this.lastReadAt.set(taskId, Date.now())
    }
  }
}

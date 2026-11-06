/** What the Usage page reads of `turns.list`: per-day, per-engine/model and per-task sums, a text bar, and the quota runway. */

/** One turn as `turns.list` returns it (the daemon's `AgentTurnRecord`). A token count an engine did not report is absent. */
export interface TurnRecord {
  readonly taskId: string
  readonly vendor?: string
  readonly model?: string
  readonly startedAt: number
  readonly endedAt: number
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number }
}

export interface Sum {
  readonly turns: number
  /** Input plus output tokens, as the footer's `Σ` counts them; cache reads are not work done. */
  readonly tokens: number
  /** Wall-clock of the turns, ms. */
  readonly ms: number
}

const EMPTY: Sum = { turns: 0, tokens: 0, ms: 0 }

const tokensOf = (turn: TurnRecord): number => (turn.usage?.input_tokens ?? 0) + (turn.usage?.output_tokens ?? 0)
const msOf = (turn: TurnRecord): number => Math.max(0, turn.endedAt - turn.startedAt)

const add = (sum: Sum, turn: TurnRecord): Sum => ({
  turns: sum.turns + 1,
  tokens: sum.tokens + tokensOf(turn),
  ms: sum.ms + msOf(turn),
})

/** The engine an unattributed turn falls under. */
export const UNKNOWN = "unknown"

/** Local calendar day, `2026-11-06`. */
export function dayKey(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface Day extends Sum {
  readonly day: string
  /** Tokens by engine id. */
  readonly byEngine: Readonly<Record<string, number>>
  /** The turn list ended inside this day or before it: its figures may be short. */
  readonly partial: boolean
}

export interface Window {
  readonly days: readonly Day[]
  /** Set when the daemon page filled its limit: turns older than the oldest one returned were cut off. */
  readonly cutoff: { readonly count: number; readonly day: string } | null
}

/**
 * The last `count` local days, oldest first, each summed from `turns`. `turns` is the newest-first page the daemon
 * sends under a limit: when it is full, the oldest turn's day (and any before it) is incomplete.
 */
export function lastDays(turns: readonly TurnRecord[], now: number, count: number, limit: number): Window {
  const keys: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    keys.push(dayKey(d.getTime()))
  }
  const sums = new Map(keys.map((key) => [key, { sum: EMPTY, byEngine: {} as Record<string, number> }]))
  for (const turn of turns) {
    const bucket = sums.get(dayKey(turn.startedAt))
    if (!bucket) continue
    const engine = turn.vendor ?? UNKNOWN
    bucket.sum = add(bucket.sum, turn)
    bucket.byEngine[engine] = (bucket.byEngine[engine] ?? 0) + tokensOf(turn)
  }
  const oldest = turns.reduce((at, turn) => Math.min(at, turn.startedAt), Number.POSITIVE_INFINITY)
  const cutoff = turns.length >= limit && Number.isFinite(oldest) ? { count: turns.length, day: dayKey(oldest) } : null
  return {
    cutoff,
    days: keys.map((key) => {
      const bucket = sums.get(key)
      return {
        day: key,
        ...(bucket?.sum ?? EMPTY),
        byEngine: bucket?.byEngine ?? {},
        partial: cutoff !== null && key <= cutoff.day,
      }
    }),
  }
}

export interface ModelRow extends Sum {
  readonly engine: string
  readonly model: string
}

/** Turns grouped by engine and model, most tokens first. */
export function byEngineModel(turns: readonly TurnRecord[]): ModelRow[] {
  const rows = new Map<string, ModelRow>()
  for (const turn of turns) {
    const engine = turn.vendor ?? UNKNOWN
    const model = turn.model ?? UNKNOWN
    const key = `${engine}\0${model}`
    rows.set(key, { engine, model, ...add(rows.get(key) ?? EMPTY, turn) })
  }
  return [...rows.values()].sort((a, b) => b.tokens - a.tokens || b.turns - a.turns)
}

export interface TaskRowSum extends Sum {
  readonly taskId: string
}

/** The `limit` tasks that used the most tokens. */
export function topTasks(turns: readonly TurnRecord[], limit: number): TaskRowSum[] {
  const rows = new Map<string, TaskRowSum>()
  for (const turn of turns) rows.set(turn.taskId, { taskId: turn.taskId, ...add(rows.get(turn.taskId) ?? EMPTY, turn) })
  return [...rows.values()].sort((a, b) => b.tokens - a.tokens || b.turns - a.turns).slice(0, limit)
}

/** `1.2k`, `4.6M`; under a thousand as is. */
export function compactTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, "")}M`
}

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]

/** A bar `width` cells wide at most, `value / max` of it filled, in eighth-block steps. */
export function bar(value: number, max: number, width: number): string {
  if (value <= 0 || max <= 0) return ""
  const eighths = Math.max(1, Math.round((value / max) * width * 8))
  return `${"█".repeat(Math.floor(eighths / 8))}${EIGHTHS[eighths % 8]}`
}

/** One glyph per engine in a stacked bar, in the order the engines are listed. */
export const ENGINE_GLYPHS = ["█", "▓", "▒", "░"] as const

/**
 * A day's bar split by engine, `width` cells for `max` tokens: each engine's run is a different shade. A day with
 * tokens always shows at least one cell per engine that has some.
 */
export function stackedBar(
  byEngine: Readonly<Record<string, number>>,
  engines: readonly string[],
  max: number,
  width: number,
): string {
  if (max <= 0) return ""
  return engines
    .map((engine, i) => {
      const tokens = byEngine[engine] ?? 0
      const cells = tokens <= 0 ? 0 : Math.max(1, Math.round((tokens / max) * width))
      return (ENGINE_GLYPHS[i % ENGINE_GLYPHS.length] ?? "█").repeat(cells)
    })
    .join("")
}

export interface QuotaWindow {
  readonly kind: string
  readonly label: string
  readonly percent: number
  readonly resetsAt: number | null
}

export type Runway =
  /** At the pace so far the window fills at `at` (epoch ms), before it resets. */
  | { readonly kind: "full"; readonly at: number }
  /** At the pace so far the window lasts until it resets. */
  | { readonly kind: "lasts" }

const WINDOW_LABEL = /^(\d+)\s*(h|d)$/

/**
 * A rough runway from what the engine already reports: the window's length (its label, `5h` / `7d`), how far into it
 * we are (its reset time) and the percent used. The pace is the average over the window so far, not a forecast;
 * null when the label, reset time or percent give nothing to go on.
 */
export function runway(window: QuotaWindow, now: number): Runway | null {
  const match = WINDOW_LABEL.exec(window.label.trim())
  if (!match || window.resetsAt === null || window.percent <= 0) return null
  const length = Number(match[1]) * (match[2] === "d" ? 24 : 1) * 3_600_000
  const elapsed = length - (window.resetsAt - now)
  if (!(elapsed > 0) || elapsed > length) return null
  if (window.percent >= 100) return { kind: "full", at: now }
  const at = now + ((100 - window.percent) / window.percent) * elapsed
  return at < window.resetsAt ? { kind: "full", at } : { kind: "lasts" }
}

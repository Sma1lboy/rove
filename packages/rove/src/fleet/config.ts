/**
 * The `fleet.*` keys in state.json: which machines may act as the center,
 * how this machine describes itself to a center, and who answers semantic
 * routing. Read per call, so a hand edit applies without a daemon restart.
 */

import { loadStateFile } from "../state/store.ts"

export interface FleetConfig {
  /** Center candidates in failover order: registered aliases or `local`. Empty = this machine. */
  readonly centers: readonly string[]
  /** What this machine offers, matched against prompts by `--machine auto`. */
  readonly tags: readonly string[]
  readonly description: string
  /** Whether the center itself takes tasks while a worker could. */
  readonly centerTakesTasks: boolean
  /** `http(s)://` endpoint that picks a node for `--machine auto`; undefined = built-in matcher. */
  readonly router?: string
  readonly routerTimeoutMs: number
}

const DEFAULT_ROUTER_TIMEOUT_MS = 4000

/** A JSON list or a comma-separated string, trimmed, empties dropped. */
function readList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  return items
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
}

function readRouter(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined
}

function readTimeout(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isFinite(n) && n >= 200 && n <= 60_000 ? n : DEFAULT_ROUTER_TIMEOUT_MS
}

export function readFleetConfig(state: Record<string, unknown> = loadStateFile()): FleetConfig {
  const router = readRouter(state["fleet.router"])
  return {
    centers: readList(state["fleet.centers"]),
    tags: readList(state["fleet.tags"]),
    description: typeof state["fleet.description"] === "string" ? state["fleet.description"].trim() : "",
    centerTakesTasks: state["fleet.centerTakesTasks"] === true,
    ...(router ? { router } : {}),
    routerTimeoutMs: readTimeout(state["fleet.routerTimeoutMs"]),
  }
}

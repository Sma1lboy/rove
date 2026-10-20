/**
 * The center's pick: which node runs a new task. Pure — the caller probes
 * the nodes and acts on the verdict.
 *
 * A node must first be ELIGIBLE (answered, has the repo, has the engine,
 * under its session cap); the center itself only when it takes tasks or no
 * worker is eligible. Among the eligible, `any` takes the least loaded and
 * `auto` takes the best match for the prompt, load breaking ties.
 */

import type { NodeStatus } from "./node-status.ts"

export type ScheduleMode = "any" | "auto"

export interface Candidate {
  readonly alias: string
  /** Null when the node did not answer; {@link why} says how. */
  readonly status: NodeStatus | null
  readonly why?: string
  readonly isCenter: boolean
}

export interface ScheduleRequest {
  readonly mode: ScheduleMode
  readonly candidates: readonly Candidate[]
  /** Normalized `origin` of the repo the task is for. */
  readonly repoRemote?: string
  /** The repo path as the caller gave it, for a repo with no remote. */
  readonly repoPath?: string
  /** An engine id the task asked for by name (`--vendor`). */
  readonly engine?: string
  readonly prompt?: string
  readonly centerTakesTasks: boolean
  /** A router's pick for `auto`, already known to name a candidate. */
  readonly routed?: string
}

export interface Rejection {
  readonly alias: string
  readonly why: string
}

export type ScheduleVerdict =
  | {
      readonly ok: true
      readonly alias: string
      /** The repo's path ON THAT NODE. */
      readonly repo?: string
      readonly reason: string
      readonly rejected: readonly Rejection[]
    }
  | { readonly ok: false; readonly rejected: readonly Rejection[] }

/** Busy share of capacity plus CPU pressure; lower is freer. */
export function nodeLoad(status: NodeStatus): number {
  const capacity = status.maxLiveSessions ?? Math.max(1, status.cpus)
  return (status.liveSessions ?? 0) / capacity + status.loadAvg1 / status.cpus
}

/**
 * How well a prompt fits a node: each tag found in the prompt counts 2, each
 * description word (3+ letters) counts 1. Substring match, so CJK tags work
 * without a tokenizer.
 */
export function matchScore(prompt: string, status: Pick<NodeStatus, "tags" | "description">): number {
  const text = prompt.toLowerCase()
  let score = 0
  for (const tag of status.tags) if (tag && text.includes(tag.toLowerCase())) score += 2
  const words = new Set(status.description.toLowerCase().split(/[^\p{L}\p{N}]+/u))
  for (const word of words) if (word.length >= 3 && text.includes(word)) score += 1
  return score
}

function repoOn(status: NodeStatus, req: ScheduleRequest): string | undefined | null {
  if (req.repoRemote) return status.repos.find((r) => r.remote === req.repoRemote)?.path ?? null
  if (req.repoPath) return status.repos.some((r) => r.path === req.repoPath) ? req.repoPath : null
  return undefined
}

interface Eligible {
  readonly alias: string
  readonly isCenter: boolean
  readonly repo?: string
  readonly load: number
  readonly score: number
}

function judge(c: Candidate, req: ScheduleRequest): Eligible | Rejection {
  const status = c.status
  if (!status) return { alias: c.alias, why: c.why ?? "did not answer" }
  const repo = repoOn(status, req)
  if (repo === null) return { alias: c.alias, why: `has no checkout of ${req.repoRemote ?? req.repoPath}` }
  if (req.engine && !status.engines.includes(req.engine)) return { alias: c.alias, why: `has no ${req.engine} engine` }
  if (status.maxLiveSessions !== undefined && (status.liveSessions ?? 0) >= status.maxLiveSessions) {
    return { alias: c.alias, why: `at its session cap (${status.maxLiveSessions})` }
  }
  return {
    alias: c.alias,
    isCenter: c.isCenter,
    ...(repo ? { repo } : {}),
    load: nodeLoad(status),
    score: req.prompt ? matchScore(req.prompt, status) : 0,
  }
}

export function pickNode(req: ScheduleRequest): ScheduleVerdict {
  const rejected: Rejection[] = []
  const eligible: Eligible[] = []
  for (const c of req.candidates) {
    const verdict = judge(c, req)
    if ("why" in verdict) rejected.push(verdict)
    else eligible.push(verdict)
  }
  const workers = eligible.filter((e) => !e.isCenter)
  const pool = req.centerTakesTasks || workers.length === 0 ? eligible : workers
  if (pool.length === 0) return { ok: false, rejected }

  const routed = req.mode === "auto" && req.routed ? pool.find((e) => e.alias === req.routed) : undefined
  if (routed) return chosen(routed, `router picked ${routed.alias}`, rejected)

  const byLoad = (a: Eligible, b: Eligible) => a.load - b.load
  if (req.mode === "auto") {
    const best = pool.reduce((a, b) => ((b.score - a.score || byLoad(a, b)) > 0 ? b : a))
    if (best.score > 0) return chosen(best, `best match for the prompt (score ${best.score})`, rejected)
  }
  const freest = pool.reduce((a, b) => (byLoad(b, a) < 0 ? b : a))
  return chosen(freest, `least loaded (load ${freest.load.toFixed(2)})`, rejected)
}

function chosen(e: Eligible, reason: string, rejected: readonly Rejection[]): ScheduleVerdict {
  return { ok: true, alias: e.alias, ...(e.repo ? { repo: e.repo } : {}), reason, rejected }
}

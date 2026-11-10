/**
 * The `gh` / `git` calls behind the PR poller: spawn `gh pr list` / `gh pr view`, classify a failure, and
 * find a task's PR by branch, pinned number or head commit. Kept apart from the poller's scheduling.
 */

import { execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import os from "node:os"
import { decodeCapturedChunks } from "./poll-scheduling.ts"
import type { GhPrView, PrUrlRunner, PrViewResult, PrViewRunner } from "./pr-status-collector.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"

/** Kill a `gh pr list` that hangs past this (network stall). */
export const PR_VIEW_TIMEOUT_MS = 10_000

/** Rank for {@link pickPr} — open beats merged/closed. */
const PR_STATE_RANK: Record<string, number> = { OPEN: 2, MERGED: 1, CLOSED: 1 }

/**
 * Open beats merged/closed; ties (incl. merged vs closed) keep the first entry,
 * which `gh pr list` returns most-recently-updated-first. Empty → undefined.
 */
export function pickPr(views: readonly GhPrView[]): GhPrView | undefined {
  let best: GhPrView | undefined
  let bestRank = -1
  for (const view of views) {
    const rank = PR_STATE_RANK[(view.state ?? "").toUpperCase()] ?? 0
    if (rank > bestRank) {
      best = view
      bestRank = rank
    }
  }
  return best
}

export interface GhSpawnResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  /** The child failed to spawn (ENOENT etc.) and it was NOT our abort. */
  readonly spawnError: boolean
  /** That spawn failure was the cwd being gone: posix_spawn reports it as the same ENOENT as a missing `gh`. */
  readonly cwdMissing: boolean
}

/** Captures stderr too (the classifier needs it). Never rejects: spawn error or
 * abort resolves with `status: null`. */
export function spawnGh(args: readonly string[], cwd: string, signal: AbortSignal): Promise<GhSpawnResult> {
  return new Promise((resolve) => {
    const outChunks: (Buffer | string)[] = []
    const errChunks: (Buffer | string)[] = []
    let settled = false
    const finish = (status: number | null, spawnError: boolean): void => {
      if (settled) return
      settled = true
      const cwdMissing = spawnError && !existsSync(cwd)
      resolve({
        status,
        stdout: decodeCapturedChunks(outChunks),
        stderr: decodeCapturedChunks(errChunks),
        spawnError,
        cwdMissing,
      })
    }
    const child = spawn("gh", args.slice(), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
      killSignal: "SIGKILL",
    })
    child.stdout?.on("data", (chunk: Buffer | string) => {
      outChunks.push(chunk)
    })
    child.stderr?.on("data", (chunk: Buffer | string) => {
      errChunks.push(chunk)
    })
    // An abort (our timeout) also surfaces as an `error` event — don't count
    // that as a spawn failure; the caller reads `timedOut` separately.
    child.on("error", () => finish(null, !signal.aborted))
    child.on("close", (code) => finish(code, false))
  })
}

/** Structurally rove's `classifyGhFailure`; injected, not imported (see header). */
type GhFailureClassifier = DaemonRuntimeAdapter["prStatus"]["classify"]

/** `gh <args>` in `cwd`: parsed stdout on exit 0, else the classified failure. Never throws. */
async function ghJson(
  classify: GhFailureClassifier,
  args: readonly string[],
  cwd: string,
): Promise<{ json: unknown } | PrViewResult> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, PR_VIEW_TIMEOUT_MS)
  try {
    const res = await spawnGh(args, cwd, controller.signal)
    if (res.status === 0 && !timedOut) {
      try {
        return { json: JSON.parse(res.stdout) }
      } catch {
        return classify({ parseError: true }) as PrViewResult
      }
    }
    return classify({
      spawnError: res.spawnError,
      cwdMissing: res.cwdMissing,
      timedOut,
      exitCode: res.status,
      stderr: res.stderr,
    }) as PrViewResult
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A task's PR, found in order: by its branch (`gh pr list --head`); by the PR
 * number it already holds (an agent may push HEAD to a differently named ref);
 * by its HEAD commit, as the head of some PR. Exit 0 + parseable JSON →
 * {@link pickPr} (nothing anywhere → `empty`); non-zero exit or bad JSON →
 * `classify`, never `empty`. Never throws.
 */
export function makeGhPrViewRunner(classify: GhFailureClassifier, viewFields: string): PrViewRunner {
  const gh = (args: readonly string[], cwd: string) => ghJson(classify, args, cwd)
  const pick = (json: unknown): PrViewResult => {
    const picked = Array.isArray(json) ? pickPr(json as GhPrView[]) : undefined
    return picked ? { kind: "pr", view: picked } : { kind: "empty" }
  }
  return async (worktreePath, branch, pinned) => {
    const byBranch = await gh(["pr", "list", "--head", branch, "--state", "all", "--json", viewFields], worktreePath)
    if (!("json" in byBranch)) return byBranch
    const listed = pick(byBranch.json)
    if (listed.kind === "pr") return listed
    // The PR this repo already held: still open, it is the answer. Settled, new work may have a new PR.
    const held: GhPrView[] = []
    if (pinned !== undefined) {
      const byNumber = await gh(["pr", "view", String(pinned), "--json", viewFields], worktreePath)
      if (!("json" in byNumber)) return byNumber
      const view = byNumber.json as GhPrView
      if ((view.state ?? "").toUpperCase() === "OPEN") return pick([view])
      held.push(view)
    }
    const head = await gitHead(worktreePath)
    if (!head) return pick(held)
    // A search hit only means the PR contains the commit; it must be the PR's head.
    const bySha = await gh(
      [
        "pr",
        "list",
        "--search",
        head,
        "--state",
        "all",
        "--json",
        viewFields.includes("headRefOid") ? viewFields : `${viewFields},headRefOid`,
      ],
      worktreePath,
    )
    if (!("json" in bySha)) return held.length > 0 ? pick(held) : bySha
    const hits = Array.isArray(bySha.json) ? bySha.json.filter((v: GhPrView) => v.headRefOid === head) : []
    return pick([...hits, ...held])
  }
}

/**
 * One session PR by URL (`gh pr view <url>`), run from the home directory: the
 * PR's checkout is wherever the session made it, and a URL needs none.
 */
export function makeGhPrUrlRunner(classify: GhFailureClassifier, viewFields: string): PrUrlRunner {
  return async (url) => {
    const res = await ghJson(classify, ["pr", "view", url, "--json", viewFields], os.homedir())
    if (!("json" in res)) return res
    if (!res.json || typeof res.json !== "object" || Array.isArray(res.json)) {
      return classify({ parseError: true }) as PrViewResult
    }
    return { kind: "pr", view: res.json as GhPrView }
  }
}

/** The worktree's HEAD commit, or undefined when git can't say. */
function gitHead(cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd, timeout: PR_VIEW_TIMEOUT_MS }, (err, stdout) => {
      const sha = String(stdout).trim()
      resolve(!err && /^[0-9a-f]{40,64}$/.test(sha) ? sha : undefined)
    })
  })
}

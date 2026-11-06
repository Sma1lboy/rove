/**
 * `task.timeline`: one task's activity, newest first, for the Files panel's `[ activity ]` list.
 * Two sources, both already the daemon's: the engine lifecycle ring (`task.recentEvents`, in
 * memory, so a daemon restart starts it empty) and the branch's commits since its base. Tool
 * calls are left out: a turn is one line, not forty.
 */

import { resolveBase } from "@sma1lboy/rove/src/tui/panes/filetree/git.ts"
import { runWorktreeGit } from "@sma1lboy/rove/src/worktree/content.ts"
import { optInt } from "../protocol.ts"
import { flag, taskId } from "./args.ts"
import type { OpTable } from "./types.ts"

const DEFAULT_LIMIT = 60
const COMMIT_LIMIT = 30
/** Field separator in the `git log` format; no subject contains it. */
const SEP = "\x1f"

export interface TimelineCommit {
  readonly sha: string
  readonly at: number
  readonly subject: string
}

export interface TimelineEntry {
  /** An engine event kind (`turn-complete`, `session-end`, ...) or `commit`. */
  readonly kind: string
  readonly at: number
  /** Tool/subagent/note detail and vendor, or a commit's subject. */
  readonly tail: string
  readonly tabId?: string
  readonly sha?: string
}

interface RingEvent {
  readonly kind: string
  readonly tabId?: string
  readonly vendor?: string
  readonly detail?: {
    tool?: { name?: string }
    compact?: { trigger?: string }
    subagent?: { type?: string }
    note?: string
  }
  readonly at: number
}

export interface TimelineDeps {
  base(worktree: string, prBaseRef: string | undefined): Promise<string | null>
  /** Commits on HEAD not on `base`, newest first. */
  commits(worktree: string, base: string): Promise<readonly TimelineCommit[]>
}

const realDeps: TimelineDeps = {
  base: (worktree, prBaseRef) => resolveBase(worktree, prBaseRef),
  async commits(worktree, base) {
    const res = await runWorktreeGit(worktree, [
      "log",
      `${base}..HEAD`,
      `--format=%H${SEP}%ct${SEP}%s`,
      "-n",
      String(COMMIT_LIMIT),
    ])
    if (res.status !== 0) return []
    return (res.stdout ?? "")
      .split("\n")
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        const [sha, secs, ...subject] = line.split(SEP)
        const at = Number(secs) * 1000
        return sha && Number.isFinite(at) ? [{ sha, at, subject: subject.join(SEP) }] : []
      })
  },
}

/** Tool calls fire per call, and the ring holds 100: the lifecycle kinds carry the story. */
const NOISE: Readonly<Record<string, true>> = { "tool-pre": true, "tool-post": true }

function eventTail(event: RingEvent): string {
  const d = event.detail
  const fragment = d?.tool?.name || d?.compact?.trigger || d?.subagent?.type || d?.note || ""
  return [fragment.length > 60 ? `${fragment.slice(0, 59)}…` : fragment, event.vendor ?? ""]
    .filter((part) => part.length > 0)
    .join(" · ")
}

/** Merge and order the two sources, newest first, capped. */
export function mergeTimeline(
  events: readonly RingEvent[],
  commits: readonly TimelineCommit[],
  limit: number,
): TimelineEntry[] {
  const rows: TimelineEntry[] = [
    ...events
      .filter((event) => !NOISE[event.kind])
      .map((event) => ({
        kind: event.kind,
        at: event.at,
        tail: eventTail(event),
        ...(event.tabId ? { tabId: event.tabId } : {}),
      })),
    ...commits.map((commit) => ({ kind: "commit", at: commit.at, tail: commit.subject, sha: commit.sha })),
  ]
  return rows.sort((a, b) => b.at - a.at).slice(0, limit)
}

export function timelineOps(deps: TimelineDeps = realDeps): OpTable {
  return {
    "task.timeline": {
      kind: "read",
      destructive: false,
      wraps: "rpc task.recentEvents (tool calls dropped) + git log <base>..HEAD, merged newest first",
      async run(a, { api }) {
        const id = taskId(a)
        const limit = optInt(a, "limit", 1, 200) ?? DEFAULT_LIMIT
        // The ring is this daemon's; another machine's task has none here.
        const events = await api
          .rpc<{ events: readonly RingEvent[] }>("task.recentEvents", { taskId: id })
          .then((res) => res.events)
          .catch((err: unknown) => {
            // A task the daemon forgot is an empty timeline, as `task.events` reads it.
            if (err instanceof Error && /task not found/i.test(err.message)) return []
            throw err
          })
        const got = await api.verb<{ task: { worktreePath?: string; prStatus?: { baseRef?: string } } }>("get-task", [
          flag("task-id", id),
        ])
        const worktree = got.task.worktreePath
        const base = worktree ? await deps.base(worktree, got.task.prStatus?.baseRef) : null
        const commits = worktree && base ? await deps.commits(worktree, base) : []
        return { entries: mergeTimeline(events, commits, limit) }
      },
    },
  }
}

export const TIMELINE_OPS: OpTable = timelineOps()

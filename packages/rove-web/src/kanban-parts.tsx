/** The Kanban page's data hooks and its card (TUI `use-kanban-boards.ts`, `kanban-card.tsx`). */

import type { IssueBoardColumn } from "@sma1lboy/rove/src/state/issue-board.ts"
import { useEffect, useState } from "react"
import type { EngineOption, Issue } from "./kanban-drawer.tsx"
import type { AppModel } from "./model.ts"
import { errorMessage, mergeRepos, useTaskRepos } from "./pages-kit.ts"

export interface Board {
  readonly repoRoot: string
  readonly nextId: number
  readonly issues: readonly Issue[]
  /** The read's error; absent = the read worked (`issues` may still be empty). */
  readonly readError?: string
}

/** Task-group badge tones, as the TUI's `taskGroupTone`. */
export const TONE: Record<string, string> = {
  "waiting-on-you": "tone-attention",
  landing: "tone-success",
  "ready-for-review": "tone-ink",
  working: "tone-accent",
}

export function useEngines(model: AppModel): { engines: readonly EngineOption[]; defaultEngine: string } {
  const [rows, setRows] = useState<readonly (EngineOption & { ready?: boolean })[]>([])
  useEffect(() => {
    model.client
      .request<{ engines: (EngineOption & { ready?: boolean })[] }>("engines.list")
      .then((res) => setRows(res.engines))
      .catch(() => setRows([]))
  }, [model])
  return { engines: rows, defaultEngine: (rows.find((row) => row.ready !== false) ?? rows[0])?.id ?? "" }
}

/**
 * Every project's issue file: saved projects, live task repos and the store's own keys, none complete
 * alone. A rejected read keeps its section, carrying the error, so a project doesn't silently vanish.
 */
export function useBoards(model: AppModel, tick: number) {
  const taskRepos = useTaskRepos(model)
  const repoKey = taskRepos.join("\n")
  const [boards, setBoards] = useState<readonly Board[] | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a trigger; the body reads taskRepos through repoKey
  useEffect(() => {
    let live = true
    const c = model.client
    const repos = (op: string) =>
      c
        .request<{ repos: string[] }>(op)
        .then((res) => res.repos)
        .catch((): string[] => [])
    void Promise.all([repos("repos.list"), repos("issue.repos")])
      .then(([saved, stored]) => mergeRepos(saved, taskRepos, stored))
      .then((all) =>
        Promise.all(
          all.map((repo) =>
            c
              .request<Board>("issue.list", { repo })
              .catch(
                (err: unknown): Board => ({ repoRoot: repo, nextId: 1, issues: [], readError: errorMessage(err) }),
              ),
          ),
        ),
      )
      .then((results) => {
        if (live) setBoards([...results].sort((a, b) => a.repoRoot.localeCompare(b.repoRoot)))
      })
    return () => {
      live = false
    }
  }, [model, tick, repoKey])
  return boards
}

export function Card(props: {
  issue: Issue
  column: IssueBoardColumn["key"]
  selected: boolean
  badge: { label: string; tone: string } | null
  onSelect: () => void
  onOpen: () => void
  onMenu: (x: number, y: number) => void
}) {
  const { issue } = props
  const body = issue.body.trim()
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the page's keys (arrows, Enter) drive the cards
    <div
      data-issue={issue.id}
      className={`kb-card ${props.selected ? "is-selected" : ""} ${props.column === "done" ? "is-done" : ""} ${props.badge?.tone === "tone-attention" ? "is-attention" : ""}`}
      onClick={() => (props.selected ? props.onOpen() : props.onSelect())}
      onContextMenu={(e) => {
        e.preventDefault()
        props.onMenu(e.clientX, e.clientY)
      }}
    >
      <div className="kb-card-head">
        <span className="kb-card-title">{issue.title}</span>
        <span className="muted mono">#{issue.id}</span>
      </div>
      <div className="kb-card-body muted">{body}</div>
      <div className="kb-card-foot mono muted">
        <span>{issue.created}</span>
        {props.badge && <span className={props.badge.tone}>{props.badge.label}</span>}
      </div>
    </div>
  )
}

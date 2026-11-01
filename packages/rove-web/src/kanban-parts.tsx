/** The Kanban page's data hooks and its card (TUI `use-kanban-boards.ts`, `kanban-card.tsx`). */

import type { IssueBoardColumn } from "@sma1lboy/rove/src/state/issue-board.ts"
import { useEffect, useState } from "react"
import type { EngineOption, Issue } from "./kanban-drawer.tsx"
import type { AppModel } from "./model.ts"
import { type ComposerEngine, defaultEngineId, offeredEngines } from "./new-session.ts"
import { errorMessage, mergeRepos, useTaskRepos } from "./pages-kit.ts"
import { lastReply, remember, requestRemembered } from "./remembered.ts"
import { KB_CARD_BODY, KB_CARD_FOOT, KB_CARD_HEAD, kbCardClass, kbCardTitleClass } from "./ui/kanban.ts"
import { MONO } from "./ui/text.ts"

export interface Board {
  readonly repoRoot: string
  readonly nextId: number
  readonly issues: readonly Issue[]
  /** The read's error; absent = the read worked (`issues` may still be empty). */
  readonly readError?: string
}

/** Task-group badge tones, as the TUI's `taskGroupTone`. */
export const TONE: Record<string, string> = {
  "waiting-on-you": "text-error",
  landing: "text-success",
  "ready-for-review": "text-ink",
  working: "text-accent",
}

export function useEngines(model: AppModel): { engines: readonly EngineOption[]; defaultEngine: string } {
  type Row = EngineOption & ComposerEngine
  const [rows, setRows] = useState<readonly Row[]>(() => {
    const last = lastReply<{ engines: Row[] }>(model, "engines.list")
    return last ? offeredEngines(last.engines) : []
  })
  useEffect(() => {
    requestRemembered<{ engines: Row[] }>(model, "engines.list")
      .then((res) => setRows(offeredEngines(res.engines)))
      .catch(() => setRows([]))
  }, [model])
  return { engines: rows, defaultEngine: defaultEngineId(rows) }
}

/**
 * Every project's issue file: saved projects, live task repos and the store's own keys, none complete
 * alone. A rejected read keeps its section, carrying the error, so a project doesn't silently vanish.
 */
export function useBoards(model: AppModel, tick: number) {
  const taskRepos = useTaskRepos(model)
  const repoKey = taskRepos.join("\n")
  // The boards as last read show at once on every visit; the reread replaces them.
  const [boards, setBoards] = useState<readonly Board[] | null>(
    () => lastReply<readonly Board[]>(model, "kanban.boards") ?? null,
  )
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
        const sorted = remember(
          model,
          "kanban.boards",
          undefined,
          [...results].sort((a, b) => a.repoRoot.localeCompare(b.repoRoot)),
        )
        if (live) setBoards(sorted)
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
      className={kbCardClass({ selected: props.selected, attention: props.badge?.tone === "text-error" })}
      onClick={() => (props.selected ? props.onOpen() : props.onSelect())}
      onContextMenu={(e) => {
        e.preventDefault()
        props.onMenu(e.clientX, e.clientY)
      }}
    >
      <div className={KB_CARD_HEAD}>
        <span className={kbCardTitleClass(props.column === "done")}>{issue.title}</span>
        <span className={`${MONO} text-muted`}>#{issue.id}</span>
      </div>
      <div className={`text-muted ${KB_CARD_BODY}`}>{body}</div>
      <div className={`${MONO} text-muted ${KB_CARD_FOOT}`}>
        <span>{issue.created}</span>
        {props.badge && <span className={props.badge.tone}>{props.badge.label}</span>}
      </div>
    </div>
  )
}

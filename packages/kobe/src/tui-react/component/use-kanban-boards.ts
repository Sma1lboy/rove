/**
 * Kanban board loading — the data half of `kanban-page.tsx`: fetch every saved
 * repo's issue file, poll it while the page is open, and land the initial
 * project/card cursor. Rendering, key handling, and mutations stay in the
 * page.
 *
 * The seam is IO: this is the only part that talks to the orchestrator, so the
 * page's own logic never has to reason about a poll landing mid-interaction.
 */

import type { RepoIssues } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { useEffect, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"

/** Agent moves land within one poll; issue.list is a local JSON read, so
 *  polling while the page is open is cheap. */
const POLL_MS = 5_000

export interface KanbanBoards {
  /** null until the first load resolves — the page shows its loading line. */
  readonly boards: readonly RepoIssues[] | null
  readonly activeRepo: string | null
  readonly setActiveRepo: (next: string | null) => void
  readonly selectedId: number | null
  readonly setSelectedId: (next: number | null | ((prev: number | null) => number | null)) => void
  /** Bump to refetch now (a mutation just landed). */
  readonly reload: () => void
}

export function useKanbanBoards(args: {
  readonly orchestrator: RemoteOrchestrator | null
  /** Opened from a task row (`c`): land on THAT task's project and put the
   *  card cursor on its linked story. */
  readonly focusTask?: { readonly id: string; readonly repo: string }
}): KanbanBoards {
  const [boards, setBoards] = useState<readonly RepoIssues[] | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  // Keyed by repoRoot (not index) so the poll refetch keeps the selection.
  const [activeRepo, setActiveRepo] = useState<string | null>(null)
  // Card cursor — an issue id (not an index) so a poll refetch that reorders
  // a column keeps the selection on the same story.
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { orchestrator, focusTask } = args
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick is a TRIGGER (the effect body doesn't read it) — the WorktreesPage refetch guard.
  useEffect(() => {
    let disposed = false
    if (!orchestrator) {
      setBoards([])
      return
    }
    const repos = [...new Set(orchestrator.listTasks().map((task) => task.repo))]
    void Promise.all(repos.map((repo) => orchestrator.listIssues(repo).catch(() => null))).then((results) => {
      if (disposed) return
      // A repo whose issue file doesn't exist yet still gets a section —
      // `exists: false` just means an empty board, not an error.
      const next = results.filter((res): res is RepoIssues => res !== null)
      next.sort((a, b) => a.repoRoot.localeCompare(b.repoRoot))
      setBoards(next)
      // First load lands on the focus task's project (opened via `c` on a
      // task row) or, without one, the project you opened kobe in — the
      // active task's repo (loose realpath tolerance, like WorktreesPage).
      const norm = (p: string): string => p.replace(/^\/private\//, "/").replace(/\/+$/, "")
      const activeId = orchestrator.activeTaskSignal().get()
      const targetRepo = focusTask?.repo ?? orchestrator.listTasks().find((task) => task.id === activeId)?.repo
      const initialBoard = targetRepo ? next.find((board) => norm(board.repoRoot) === norm(targetRepo)) : undefined
      setActiveRepo((prev) => prev ?? initialBoard?.repoRoot ?? null)
      // …and the card cursor on the focus task's linked story, if any.
      const focusId = focusTask?.id
      const linked = focusId ? initialBoard?.issues.find((issue) => issue.taskId === focusId) : undefined
      if (linked) setSelectedId((prev) => prev ?? linked.id)
    })
    const timer = setInterval(() => setReloadTick((tick) => tick + 1), POLL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [orchestrator, reloadTick, focusTask])

  return {
    boards,
    activeRepo,
    setActiveRepo,
    selectedId,
    setSelectedId,
    reload: () => setReloadTick((tick) => tick + 1),
  }
}

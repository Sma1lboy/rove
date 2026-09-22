/**
 * Data half of `kanban-page.tsx` (the only part that talks to the
 * orchestrator): fetch every repo's issue file, poll while open, and land the
 * initial project/card cursor.
 *
 * Repos are the union of three sources, none complete alone: the store's own
 * keys (`issue.repos`; `issue-create --repo` can reach a repo with no task or
 * saved entry), SAVED projects (empty boards to file into), and LIVE task
 * repos. Tasks alone would drop every card once the task is deleted.
 */

import type { RepoIssues } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { useEffect, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { errorMessage } from "../../lib/error-message"
import { isRemoteRepoKey } from "../../state/remote-repos"
import { getSavedRepos } from "../../state/repos"

/** Agent moves land within one poll; issue.list is a local JSON read, so
 *  polling while the page is open is cheap. */
const POLL_MS = 5_000

/**
 * A project's board plus what {@link RepoIssues} can't express: the read
 * REJECTED. The section stays (so the project isn't silently missing from the
 * selector) and carries the failure.
 */
export interface KanbanBoardEntry extends RepoIssues {
  /** The read's error message. Absent = the read succeeded (`issues` may
   *  still be empty, which is a real empty board, not a failure). */
  readonly readError?: string
}

export interface KanbanBoards {
  /** null until the first load resolves — the page shows its loading line. */
  readonly boards: readonly KanbanBoardEntry[] | null
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
  const [boards, setBoards] = useState<readonly KanbanBoardEntry[] | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  // Keyed by repoRoot (not index) so the poll refetch keeps the selection.
  const [activeRepo, setActiveRepo] = useState<string | null>(null)
  // Card cursor by issue id, so a reordering poll keeps the same story.
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { orchestrator, focusTask } = args
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick is a TRIGGER (the effect body doesn't read it) — the WorktreesPage refetch guard.
  useEffect(() => {
    let disposed = false
    if (!orchestrator) {
      setBoards([])
      return
    }
    const local = [...getSavedRepos(), ...orchestrator.listTasks().map((task) => task.repo)]
    void orchestrator
      .listIssueRepos()
      // A daemon without `issue.repos` falls back to the local sources.
      .catch((): readonly string[] => [])
      .then((stored) => {
        // `ssh://` saved keys are remote projects; the issue store is keyed by
        // git path and would reject each one as a visible read error.
        const repos = [...new Set([...local, ...stored])].filter((repo) => repo && !isRemoteRepoKey(repo))
        return Promise.all(
          repos.map((repo) =>
            orchestrator.listIssues(repo).catch(
              (err: unknown): KanbanBoardEntry => ({
                // `readError` separates "could not read" from "no file yet".
                repoRoot: repo,
                exists: false,
                nextId: 1,
                issues: [],
                skipped: 0,
                readError: errorMessage(err),
              }),
            ),
          ),
        )
      })
      .then((results) => {
        if (disposed) return
        // Without `readError`, `exists: false` is just an empty board.
        const next = [...results]
        next.sort((a, b) => a.repoRoot.localeCompare(b.repoRoot))
        setBoards(next)
        // First load: the focus task's project, else the active task's repo
        // (loose realpath match).
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

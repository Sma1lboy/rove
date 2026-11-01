/**
 * The Kanban page (TUI `kanban-page.tsx`): the daemon-owned issue store as a Backlog / In progress /
 * Parked / Done board, one project at a time. Tab cycles projects, arrows or h/j/k/l move the card,
 * Enter (or a click on the selected card) opens the story drawer, `n` files a story, `d` deletes
 * after a confirm, `r` refetches, right-click moves a card to another status, q/Esc close. A 5 s
 * poll shows agent moves (`rove api issue-*`) live. Column math is the TUI's `state/issue-board.ts`.
 */

import {
  type IssueBoardColumn,
  applyBoardAttention,
  buildIssueBoard,
  moveBoardSelection,
} from "@sma1lboy/rove/src/state/issue-board.ts"
import { useEffect, useRef, useState } from "react"
import { ConfirmDialog, errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { ISSUE_STATUSES, type Issue, IssueDrawer, type IssueStatus, type Outcome } from "./kanban-drawer.tsx"
import { type Placement, startStory } from "./kanban-start.ts"
import type { AppModel } from "./model.ts"
import {
  errorMessage,
  fill,
  projectLabel,
  useCopy,
  usePageFocus,
  usePageKeys,
  useReload,
  useSelectedRepo,
} from "./pages-kit.ts"
import { useStore } from "./store.ts"
import { dialog, menu, page, toast } from "./ui.ts"

import { type Board, Card, TONE, useBoards, useEngines } from "./kanban-parts.tsx"
const POLL_MS = 5_000
/** Four lanes need about this much width before a card stops being readable. */
const MIN_BOARD_PX = 760
import {
  KB_BOARD,
  KB_CARDS,
  KB_CARDS_NOTE,
  KB_EMPTY,
  KB_PAGE,
  KB_PROJECT,
  KB_PROJECT_NAME,
  KB_PROJECT_PATH,
  KB_SINGLE,
  KB_STRIP,
  kbLaneClass,
  kbLaneHeadClass,
  kbStripTabClass,
} from "./ui/kanban.ts"

export function KanbanView({ model }: { model: AppModel }) {
  const { kanban, group, common } = useCopy()
  const [tick, reload] = useReload(POLL_MS)
  const boards = useBoards(model, tick)
  const { engines, defaultEngine } = useEngines(model)
  const payload = useStore(model.tasks)
  const selectedRepo = useSelectedRepo(model)
  const [activeRepo, setActiveRepo] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const root = usePageFocus()
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const observer = new ResizeObserver(() => setNarrow(el.clientWidth < MIN_BOARD_PX))
    observer.observe(el)
    return () => observer.disconnect()
  }, [root])

  const list = boards ?? []
  // The project the selected task lives in is where the board opens (TUI: the active task's repo).
  const landing = selectedRepo
    ? list.find((b) => b.repoRoot.replace(/^\/private\//, "/") === selectedRepo.replace(/^\/private\//, "/"))
    : undefined
  const index = Math.max(
    0,
    list.findIndex((b) => b.repoRoot === (activeRepo ?? landing?.repoRoot)),
  )
  const board = list[index]
  const repoRoots = list.map((b) => b.repoRoot)

  // A read error toasts once per distinct set, not on every poll.
  const errorKey = list
    .filter((b) => b.readError)
    .map((b) => `${b.repoRoot}\0${b.readError}`)
    .join("\n")
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the error set; list is new every render
  useEffect(() => {
    for (const b of list) {
      if (b.readError) {
        toast(fill(kanban.readFailedToast, { repo: projectLabel(b.repoRoot, repoRoots), error: b.readError }), "error")
      }
    }
  }, [errorKey])

  const tasks = payload?.tasks ?? []
  const known = new Set(tasks.map((task) => task.id))
  const groupOf = (taskId: string) => tasks.find((task) => task.id === taskId)?.group
  const { columns, attentionCount } = applyBoardAttention(
    board ? buildIssueBoard(board.issues, known.size === 0 ? undefined : (id) => known.has(id)) : [],
    (taskId) => groupOf(taskId) === "waiting-on-you",
  )
  const laneLabel = {
    backlog: kanban.column.backlog,
    in_progress: kanban.column.inProgress,
    parked: kanban.column.parked,
    done: kanban.column.done,
  }
  const badgeOf = (issue: Issue, column: IssueBoardColumn["key"]) => {
    const g = issue.taskId && (column === "in_progress" || column === "parked") ? groupOf(issue.taskId) : undefined
    const label =
      g === "waiting-on-you"
        ? group.waitingOnYou
        : g === "landing"
          ? group.landing
          : g === "ready-for-review"
            ? group.readyForReview
            : g === "working"
              ? group.working
              : null
    return g && label ? { label, tone: TONE[g] ?? "muted" } : null
  }

  const mutate = async (op: string, args: Record<string, unknown>, failed: string, id: number) => {
    try {
      return await model.client.request<Board>(op, { repo: board?.repoRoot, ...args })
    } catch (err) {
      toast(fill(failed, { id: String(id), error: errorMessage(err) }), "error")
      return null
    } finally {
      reload()
    }
  }
  const setStatus = (issue: Issue, status: IssueStatus) =>
    mutate("issue.setStatus", { id: issue.id, status }, kanban.statusFailed, issue.id)

  const openTask = (taskId: string) => {
    page.set(null)
    model.select(taskId)
  }

  const start = async (repo: string, issue: Issue, choice: { engine: string; placement: Placement; jump: boolean }) => {
    try {
      const res = await startStory(model.client, { repo, issue, engine: choice.engine, placement: choice.placement })
      for (const warning of res.warnings) {
        toast(
          fill(warning.kind === "link" ? kanban.linkFailed : kanban.statusFailed, {
            id: String(issue.id),
            error: warning.error,
          }),
          "error",
        )
      }
      if (choice.jump) {
        page.set(null)
        model.selectWhenListed(res.taskId)
        if (res.tabId) await model.refreshTabsNow().then(() => model.select(res.taskId, res.tabId))
      } else {
        toast(fill(kanban.detail.startedBackground, { title: `#${issue.id} ${issue.title}` }))
      }
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      reload()
    }
  }

  const finishDetail = async (issue: Issue, outcome: Outcome) => {
    if (!board) return
    if (outcome.kind === "create") return
    // Only fields changed since the drawer opened: writing an untouched one back would revert an agent's edit.
    const patch: { title?: string; body?: string } = {}
    if (outcome.title !== issue.title) patch.title = outcome.title
    if (outcome.body !== issue.body) patch.body = outcome.body
    if (patch.title !== undefined || patch.body !== undefined) {
      await mutate("issue.update", { id: issue.id, ...patch }, kanban.updateFailed, issue.id)
    }
    if (outcome.status !== issue.status) await setStatus(issue, outcome.status)
    if (outcome.kind === "open") openTask(outcome.taskId)
    else if (outcome.kind === "unlink") {
      await mutate("issue.update", { id: issue.id, task: "none" }, kanban.unlinkFailed, issue.id)
    } else if (outcome.kind === "start") {
      await start(board.repoRoot, { ...issue, ...patch }, outcome)
    }
  }

  const openDetail = (issue: Issue) => {
    if (!board) return
    setSelectedId(issue.id)
    dialog.set(
      <IssueDrawer
        model={model}
        issue={issue}
        mode="detail"
        engines={engines}
        defaultEngine={defaultEngine}
        onOutcome={(outcome) => void finishDetail(issue, outcome)}
      />,
    )
  }

  const openIntake = () => {
    if (!board) return
    const repo = board.repoRoot
    const blank: Issue = {
      id: board.nextId,
      title: "",
      status: "open",
      created: new Date().toISOString().slice(0, 10),
      body: "",
    }
    dialog.set(
      <IssueDrawer
        model={model}
        issue={blank}
        mode="create"
        engines={engines}
        defaultEngine={defaultEngine}
        onOutcome={(outcome) => {
          if (outcome.kind !== "create") return
          void (async () => {
            try {
              const state = await model.client.request<Board>("issue.create", {
                repo,
                title: outcome.title,
                body: outcome.body,
              })
              reload()
              if (!outcome.start) return
              // The daemon allocates the id from nextId; fall back to the newest record if a racing writer moved the counter.
              const created =
                state.issues.find((entry) => entry.id === blank.id) ??
                state.issues.reduce<Issue | null>((max, entry) => (max && max.id > entry.id ? max : entry), null)
              if (created) await start(repo, created, outcome.start)
            } catch (err) {
              toast(fill(kanban.createFailed, { error: errorMessage(err) }), "error")
            }
          })()
        }}
      />,
    )
  }

  const requestDelete = () => {
    const issue = board?.issues.find((entry) => entry.id === selectedId)
    if (!board || !issue) return
    const repo = board.repoRoot
    dialog.set(
      <ConfirmDialog
        title={fill(kanban.confirmDelete.title, { id: String(issue.id) })}
        body={fill(kanban.confirmDelete.body, { title: issue.title })}
        confirmLabel={common.confirm}
        onConfirm={async () => {
          try {
            await model.client.request("issue.delete", { repo, id: issue.id })
            setSelectedId(null)
          } catch (err) {
            toast(fill(kanban.deleteFailed, { id: String(issue.id), error: errorMessage(err) }), "error")
          } finally {
            reload()
          }
        }}
      />,
    )
  }

  const cycleProject = (delta: number) => {
    if (list.length === 0) return
    setActiveRepo(list[(index + delta + list.length) % list.length]?.repoRoot ?? null)
    setSelectedId(null)
  }
  const moveCursor = (dir: "up" | "down" | "left" | "right") => {
    const next = moveBoardSelection(columns, selectedId, dir)
    if (next != null) setSelectedId(next)
  }
  // Left/right walk cards; on an empty board they cycle projects like Tab.
  const moveOrCycle = (dir: "left" | "right") =>
    columns.some((column) => column.issues.length > 0) ? moveCursor(dir) : cycleProject(dir === "left" ? -1 : 1)

  usePageKeys((e) => {
    if (e.ctrlKey) {
      if (e.key !== "c") return false
      page.set(null)
      return true
    }
    switch (e.key) {
      case "Escape":
      case "q":
        page.set(null)
        return true
      case "r":
        reload()
        return true
      case "Tab":
        cycleProject(e.shiftKey ? -1 : 1)
        return true
      case "ArrowUp":
        moveCursor("up")
        return true
      case "ArrowDown":
        moveCursor("down")
        return true
      case "ArrowRight":
      case "l":
        moveOrCycle("right")
        return true
      case "ArrowLeft":
      case "h":
        moveOrCycle("left")
        return true
      case "Enter": {
        const issue = board?.issues.find((entry) => entry.id === selectedId)
        if (issue) openDetail(issue)
        return true
      }
      case "n":
        openIntake()
        return true
      case "d":
        requestDelete()
        return true
      default:
        return false
    }
  })

  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.querySelector(`[data-issue="${selectedId}"]`)?.scrollIntoView({ block: "nearest" })
  }, [selectedId])

  const openMenuFor = (issue: Issue, x: number, y: number) => {
    setSelectedId(issue.id)
    menu.set({
      x,
      y,
      items: ISSUE_STATUSES.filter((status) => status !== issue.status).map((status) => ({
        label: fill(kanban.menu.setStatus, { status: kanban.detail.status[status] }),
        run: () => void setStatus(issue, status),
      })),
    })
  }

  const activeLane =
    columns.find((col) => col.issues.some((issue) => issue.id === selectedId)) ??
    columns.find((col) => col.issues.length > 0) ??
    columns[0]
  const lane = (col: IssueBoardColumn, header: boolean) => (
    <section key={col.key} className={kbLaneClass(!header)}>
      {header && (
        <h2 className={kbLaneHeadClass(col.key)}>
          <span>
            {laneLabel[col.key]} ({col.issues.length + col.hiddenCount})
          </span>
          {col.key === "in_progress" && attentionCount > 0 && (
            <span className="tone-warning">{fill(kanban.attention, { count: String(attentionCount) })}</span>
          )}
        </h2>
      )}
      <div className={KB_CARDS}>
        {col.issues.map((issue) => (
          <Card
            key={issue.id}
            issue={issue}
            column={col.key}
            selected={issue.id === selectedId}
            badge={badgeOf(issue, col.key)}
            onSelect={() => setSelectedId(issue.id)}
            onOpen={() => openDetail(issue)}
            onMenu={(x, y) => openMenuFor(issue, x, y)}
          />
        ))}
        {col.issues.length === 0 && col.hiddenCount === 0 && (
          <p className={`muted mono ${KB_CARDS_NOTE}`}>{kanban.columnEmpty}</p>
        )}
        {col.hiddenCount > 0 && (
          <p className={`muted mono ${KB_CARDS_NOTE}`}>{fill(kanban.more, { count: String(col.hiddenCount) })}</p>
        )}
      </div>
    </section>
  )

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className={`page ${KB_PAGE}`} tabIndex={0} ref={root}>
      <div className="kb-top">
        <h1 className="page-title">{kanban.title}</h1>
        <span className="muted mono kb-hint-line">{kanban.hint}</span>
        {/* A phone has no n/d: the same verbs as buttons. Delete acts on the selected card. */}
        <span className="pg-actions mono">
          <button type="button" className="link" disabled={!board} onClick={openIntake}>
            {t("pages.new")}
          </button>
          <button
            type="button"
            className="link"
            disabled={!board?.issues.some((entry) => entry.id === selectedId)}
            onClick={requestDelete}
          >
            {t("pages.delete")}
          </button>
        </span>
      </div>
      {boards === null ? (
        <p className="muted">{kanban.loading}</p>
      ) : !board ? (
        <p className="muted">{kanban.noRepos}</p>
      ) : (
        <>
          <div className={KB_PROJECT}>
            <button type="button" className={KB_PROJECT_NAME} onClick={() => cycleProject(1)}>
              {projectLabel(board.repoRoot, repoRoots)}
              {list.length > 1 && <span className="muted">{` ${index + 1}/${list.length}`}</span>}
            </button>
            {!narrow && <span className={`muted mono ${KB_PROJECT_PATH}`}>{board.repoRoot}</span>}
            {board.issues.length === 0 && !board.readError && (
              <span className={`muted ${KB_EMPTY}`}>{kanban.empty}</span>
            )}
          </div>
          {board.readError ? (
            <p className="error">{fill(kanban.readFailed, { error: board.readError })}</p>
          ) : narrow && activeLane ? (
            <div className={KB_SINGLE} ref={scroller}>
              <div className={`mono ${KB_STRIP}`}>
                {columns.map((col) => (
                  <button
                    type="button"
                    key={col.key}
                    className={kbStripTabClass(col.key === activeLane.key)}
                    onClick={() => {
                      const first = col.issues[0]
                      if (first) setSelectedId(first.id)
                    }}
                  >
                    {laneLabel[col.key]} ({col.issues.length + col.hiddenCount})
                  </button>
                ))}
              </div>
              {lane(activeLane, false)}
            </div>
          ) : (
            <div className={KB_BOARD} ref={scroller}>
              {columns.map((col) => lane(col, true))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

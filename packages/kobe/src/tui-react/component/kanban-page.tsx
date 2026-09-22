/** @jsxImportSource @opentui/react */
/**
 * The daemon-owned issue store as a Backlog / In progress / Parked / Done
 * board, one PROJECT at a time. Full-page swap: esc/ctrl+c closes, `r`
 * refetches, and a light poll shows agent moves (`kobe api issue-*`) live.
 *
 * Human surface: cursor + {@link IssueDetailDialog} (Start hands an
 * {@link IssueChatStart} to the host). Column math lives in
 * `state/issue-board.ts`: done > parked > linked-task > backlog.
 *
 * Owns data and actions (`enter` / `n` / `d`); lane layout is
 * {@link KanbanBoard}'s, and only the measured width crosses that seam.
 */

import { type BoxRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import type { Issue, IssueStatus } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { RemoteOrchestrator, TaskEngineState } from "../../client/remote-orchestrator"
import { availableEngineIds } from "../../engine/account-detect"
import { engineDisplayName } from "../../engine/interactive-command"
import { errorMessage } from "../../lib/error-message"
import type { TaskGroup } from "../../lib/task-group"
import { applyBoardAttention, buildIssueBoard, moveBoardSelection } from "../../state/issue-board"
import { sidebarProjectLabel } from "../../tui/panes/sidebar/groups"
import { taskGroupIn } from "../../tui/panes/sidebar/task-group-view"
import type { VendorId } from "../../types/task"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { isNarrowWidth } from "../lib/narrow-mode"
import { useCursorFollow } from "../lib/use-cursor-follow"
import { ContextMenu } from "../ui/context-menu"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { quickForkDefaultVendor } from "../workspace/quick-fork"
import type { IssueChatStart } from "../workspace/use-issue-chat"
import { IssueDetailDialog } from "./issue-detail-dialog"
import { KanbanBoard, needsSingleLane } from "./kanban-board"
import { type KanbanBoardEntry, useKanbanBoards } from "./use-kanban-boards"
import { useKanbanCardMenu } from "./use-kanban-card-menu"

/** paddingLeft + paddingRight on the page root, whose width is what we measure. */
const PAGE_PADDING_CELLS = 4

export function KanbanPage(props: {
  orchestrator: RemoteOrchestrator | null
  onClose: () => void
  /** False while another pane holds focus (the board is a content-pane page). */
  focused?: boolean
  /** Detail drawer's Start — the host owns task creation + prompt handoff. */
  onStartChat: (request: IssueChatStart) => Promise<void>
  /** Open a linked story's existing session (closes the kanban page). */
  onOpenTask: (taskId: string) => void
  /** Per-task engine activity (host's `engineStateSignal`) for card badges. */
  engineStates?: ReadonlyMap<string, TaskEngineState>
  /** Opened from a task (`c` on the sidebar row): land on its project with
   *  the cursor on its linked story. */
  focusTask?: { readonly id: string; readonly repo: string }
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const dialog = useDialog()
  // Toast mutation failures: console.error is invisible under the alternate
  // screen. Empty taskId/tabId — the page isn't scoped to a chat tab.
  const notif = useNotifications()
  function notifyError(message: string): void {
    notif.notify({ kind: "error", taskId: "", tabId: "", title: message })
  }
  // Full screen, not the page box: the card menu is clamped against it.
  const dims = useTerminalDimensions()
  const narrow = isNarrowWidth(dims.width)
  // The sidebar takes width first, so measure the page root — mounted in both
  // layouts; measuring the four-lane box would unmount it and oscillate.
  const pageRef = useRef<BoxRenderable | null>(null)
  const [pageCells, setPageCells] = useState<number | null>(null)
  const singleLane = needsSingleLane(pageCells === null ? null : pageCells - PAGE_PADDING_CELLS) ?? narrow

  // Engines for the drawer's picker: one account-file probe per page open.
  const [engines, setEngines] = useState<readonly VendorId[]>([])
  useEffect(() => {
    let disposed = false
    void availableEngineIds().then((ids) => {
      if (!disposed) setEngines(ids)
    })
    return () => {
      disposed = true
    }
  }, [])
  const { boards, activeRepo, setActiveRepo, selectedId, setSelectedId, reload } = useKanbanBoards({
    orchestrator: props.orchestrator,
    focusTask: props.focusTask,
  })

  const boardList = boards ?? []
  const activeIndex = Math.max(
    0,
    boardList.findIndex((board) => board.repoRoot === activeRepo),
  )
  const activeBoard: KanbanBoardEntry | undefined = boardList[activeIndex]
  const repoRoots = boardList.map((board) => board.repoRoot)
  // Toast once per DISTINCT error set: the poll must not re-toast a
  // still-broken repo, but a new repo or new error fires again.
  const readErrorKey = boardList
    .filter((board) => board.readError)
    .map((board) => `${board.repoRoot}\u0000${board.readError}`)
    .join("\n")
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the error SET — notifyError/boardList are new every render and would re-toast on every frame.
  useEffect(() => {
    for (const board of boardList) {
      if (!board.readError) continue
      notifyError(
        t("kanban.readFailedToast", {
          repo: sidebarProjectLabel(board.repoRoot, repoRoots),
          error: board.readError,
        }),
      )
    }
  }, [readErrorKey])
  // Rendering-only attention float: blocked-on-you cards lead In progress.
  // The task index, not the link alone, decides In progress: an old store can
  // link a task that no longer exists. Unresolvable = Backlog (Start again).
  // An EMPTY index means "not loaded yet": no predicate, the link decides —
  // else every In-progress card flashes into Backlog for a frame.
  const knownTasks = props.orchestrator?.listTasks() ?? []
  const knownTaskIds = new Set<string>(knownTasks.map((task) => task.id))
  // One derivation for badge, attention float and "N need you", so they can't
  // disagree; the sidebar's `attention` sort uses the same one.
  const taskGroupOf = (taskId: string): TaskGroup | undefined => {
    const task = knownTasks.find((candidate) => candidate.id === taskId)
    return task ? taskGroupIn(task, props.engineStates?.get(taskId)) : undefined
  }
  const { columns, attentionCount } = applyBoardAttention(
    activeBoard
      ? buildIssueBoard(activeBoard.issues, knownTaskIds.size === 0 ? undefined : (taskId) => knownTaskIds.has(taskId))
      : [],
    (taskId) => taskGroupOf(taskId) === "waiting-on-you",
  )

  // One instance covers all lanes: `scrollChildIntoView` no-ops on lanes that
  // don't hold the card.
  const follow = useCursorFollow(selectedId)

  // Same `setStatus` op as the drawer's status chips.
  const cardMenu = useKanbanCardMenu({
    onSelect: setSelectedId,
    setStatus: (issue: Issue, status: IssueStatus) => {
      const repoRoot = activeBoard?.repoRoot
      if (!repoRoot) return
      void props.orchestrator
        ?.mutateIssue(repoRoot, { type: "setStatus", id: issue.id, status })
        .catch((err: unknown) => {
          console.error("[rove kanban] issue status change failed:", err)
          notifyError(t("kanban.statusFailed", { id: String(issue.id), error: errorMessage(err) }))
        })
        .finally(() => reload())
    },
  })

  function cycleProject(delta: number): void {
    if (boardList.length === 0) return
    const next = (activeIndex + delta + boardList.length) % boardList.length
    setActiveRepo(boardList[next]?.repoRoot ?? null)
    setSelectedId(null)
  }

  function moveCursor(dir: "up" | "down" | "left" | "right"): void {
    const next = moveBoardSelection(columns, selectedId, dir)
    if (next != null) setSelectedId(next)
  }

  // ←/→ move cards; on an empty board they cycle projects like tab.
  function moveOrCycle(dir: "left" | "right"): void {
    if (columns.some((column) => column.issues.length > 0)) moveCursor(dir)
    else cycleProject(dir === "left" ? -1 : 1)
  }

  /** Enter / click on the selected card. A dirty title/body persists
   *  best-effort — it must not block the start/open. undefined = discarded. */
  function openDetail(issue: Issue): void {
    const board = activeBoard
    if (!board) return
    setSelectedId(issue.id)
    void IssueDetailDialog.show(dialog, {
      issue,
      engines,
      defaultVendor: quickForkDefaultVendor(board.repoRoot, engines),
      engineLabel: engineDisplayName,
      orchestrator: props.orchestrator,
    }).then(async (outcome) => {
      if (!outcome) return
      // ONLY fields changed vs the open-time snapshot: writing an untouched
      // field back would silently revert an agent's edit made meanwhile. The
      // store leaves absent fields alone.
      const patch: { title?: string; body?: string } = {}
      if (outcome.title !== issue.title) patch.title = outcome.title
      if (outcome.body !== issue.body) patch.body = outcome.body
      if (patch.title !== undefined || patch.body !== undefined) {
        await props.orchestrator
          ?.mutateIssue(board.repoRoot, { type: "update", id: issue.id, ...patch })
          .catch((err: unknown) => {
            // The reload repaints the OLD title; without a toast a failure is invisible.
            console.error("[rove kanban] issue update failed:", err)
            notifyError(t("kanban.updateFailed", { id: String(issue.id), error: errorMessage(err) }))
          })
        reload()
      }
      // Status needs `setStatus` (`update` carries title/body/taskId only);
      // same open-time comparison. The `create` narrow is for the type only.
      if (outcome.kind !== "create" && outcome.status !== issue.status) {
        await props.orchestrator
          ?.mutateIssue(board.repoRoot, { type: "setStatus", id: issue.id, status: outcome.status })
          .catch((err: unknown) => {
            console.error("[rove kanban] issue status change failed:", err)
            notifyError(t("kanban.statusFailed", { id: String(issue.id), error: errorMessage(err) }))
          })
        reload()
      }
      if (outcome.kind === "open") {
        props.onOpenTask(outcome.taskId)
        return
      }
      if (outcome.kind === "unlink") {
        await props.orchestrator
          ?.mutateIssue(board.repoRoot, { type: "unlink", id: issue.id })
          .catch((err: unknown) => {
            console.error("[rove kanban] issue unlink failed:", err)
            notifyError(t("kanban.unlinkFailed", { id: String(issue.id), error: errorMessage(err) }))
          })
        reload()
        return
      }
      // "close" saved above; "create" never comes from detail mode.
      if (outcome.kind !== "start") return
      void props.onStartChat({
        repoRoot: board.repoRoot,
        issue: { ...issue, ...patch },
        vendor: outcome.vendor,
        placement: outcome.placement,
        jump: outcome.jump,
      })
    })
  }

  /** `n`: drawer in create mode. ctrl+s files; enter/ctrl+enter files AND
   *  starts at the chosen engine/placement. */
  function openIntake(): void {
    const board = activeBoard
    if (!board) return
    const blank: Issue = {
      id: board.nextId,
      title: "",
      status: "open",
      created: new Date().toISOString().slice(0, 10),
      body: "",
    }
    void IssueDetailDialog.show(dialog, {
      issue: blank,
      mode: "create",
      engines,
      defaultVendor: quickForkDefaultVendor(board.repoRoot, engines),
      engineLabel: engineDisplayName,
    }).then(async (outcome) => {
      if (!outcome || outcome.kind !== "create") return
      const orch = props.orchestrator
      if (!orch) return
      try {
        const state = await orch.mutateIssue(board.repoRoot, {
          type: "create",
          title: outcome.title,
          body: outcome.body,
        })
        reload()
        if (!outcome.start) return
        // The daemon allocates the id from nextId; fall back to the newest
        // record if another writer raced the counter between open and save.
        const created =
          state.issues.find((entry) => entry.id === board.nextId) ??
          state.issues.reduce<Issue | null>((max, entry) => (max && max.id > entry.id ? max : entry), null)
        if (!created) return
        void props.onStartChat({
          repoRoot: board.repoRoot,
          issue: created,
          vendor: outcome.start.vendor,
          placement: outcome.start.placement,
          jump: outcome.start.jump,
        })
      } catch (err) {
        console.error("[rove kanban] issue create failed:", err)
        notifyError(t("kanban.createFailed", { error: errorMessage(err) }))
      }
    })
  }

  /** `d`: delete after confirm — ONLY the issue record; a linked
   *  task/branch/worktree is untouched. */
  function requestDelete(): void {
    const board = activeBoard
    const issue = board?.issues.find((entry) => entry.id === selectedId)
    if (!board || !issue) return
    void DialogConfirm.show(
      dialog,
      t("kanban.confirmDelete.title", { id: String(issue.id) }),
      t("kanban.confirmDelete.body", { title: issue.title }),
      undefined,
      undefined,
      { danger: true },
    ).then((confirmed) => {
      if (!confirmed) return
      void props.orchestrator
        ?.mutateIssue(board.repoRoot, { type: "delete", id: issue.id })
        .then(() => {
          setSelectedId(null)
          reload()
        })
        .catch((err: unknown) => {
          console.error("[rove kanban] issue delete failed:", err)
          notifyError(t("kanban.deleteFailed", { id: String(issue.id), error: errorMessage(err) }))
        })
    })
  }

  useBindings(() => ({
    // Dormant while a dialog or the card menu owns the keyboard, and while
    // another pane (the sidebar) has focus — bare letters must not leak.
    enabled: dialog.stack.length === 0 && props.focused !== false && !cardMenu.open,
    bindings: [
      ...pageCloseBindings(props.onClose),
      { key: "r", cmd: () => reload() },
      { key: "tab", cmd: () => cycleProject(1) },
      { key: "up", cmd: () => moveCursor("up") },
      { key: "down", cmd: () => moveCursor("down") },
      { key: "right", cmd: () => moveOrCycle("right") },
      { key: "left", cmd: () => moveOrCycle("left") },
      {
        key: "return",
        cmd: () => {
          const issue = activeBoard?.issues.find((entry) => entry.id === selectedId)
          if (issue) openDetail(issue)
        },
      },
      { key: "n", cmd: () => openIntake() },
      { key: "d", cmd: () => requestDelete() },
    ],
  }))

  /** One-line rolling project selector (click cycles); the full path is
   *  dropped in single-lane layout. */
  function projectSelector(active: KanbanBoardEntry): ReactNode {
    return (
      <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
        <box flexDirection="row" onMouseUp={() => cycleProject(1)}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
            {sidebarProjectLabel(active.repoRoot, repoRoots)}
          </text>
          {boardList.length > 1 ? (
            <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
              {" "}
              {activeIndex + 1}/{boardList.length}
            </text>
          ) : null}
          {singleLane ? null : (
            <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
              {"  "}
              {active.repoRoot}
            </text>
          )}
        </box>
        {active.issues.length === 0 && !active.readError ? (
          <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
            {t("kanban.empty")}
          </text>
        ) : null}
      </box>
    )
  }

  const loading = boards === null

  // x=2 root inset shared with the other rail pages; no per-child inset.
  return (
    <box
      ref={(r: BoxRenderable | null) => {
        pageRef.current = r
      }}
      onSizeChange={() => setPageCells(pageRef.current?.width ?? null)}
      flexGrow={1}
      backgroundColor={theme.background}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text attributes={TextAttributes.BOLD} fg={theme.text} wrapMode="none" flexShrink={0}>
          {t("kanban.title")}
        </text>
        {/* Shrinkable so a tight terminal clips the legend, not the title —
            un-shrunk the two texts overlapped into one glued string. */}
        <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
          {t("kanban.hint")}
        </text>
      </box>
      {loading ? (
        <text fg={theme.textMuted}>{t("kanban.loading")}</text>
      ) : boardList.length === 0 || !activeBoard ? (
        <text fg={theme.textMuted}>{t("kanban.noRepos")}</text>
      ) : (
        <>
          {projectSelector(activeBoard)}
          {activeBoard.readError ? (
            // In place of the four columns, NOT in place of the project: empty
            // lanes here would read as "this project has no stories".
            <text fg={theme.error} wrapMode="none">
              {t("kanban.readFailed", { error: activeBoard.readError })}
            </text>
          ) : (
            <KanbanBoard
              columns={columns}
              attentionCount={attentionCount}
              selectedId={selectedId}
              singleLane={singleLane}
              taskGroupOf={taskGroupOf}
              follow={follow}
              onSelect={setSelectedId}
              onOpen={openDetail}
              onCardContextMenu={cardMenu.openForCard}
            />
          )}
        </>
      )}
      {cardMenu.open ? (
        <ContextMenu
          entries={cardMenu.entries}
          cursor={cardMenu.cursor}
          x={cardMenu.x}
          y={cardMenu.y}
          dims={dims}
          onPick={cardMenu.pick}
        />
      ) : null}
    </box>
  )
}

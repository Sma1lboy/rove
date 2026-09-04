/** @jsxImportSource @opentui/react */
/**
 * KanbanPage — the daemon-owned issue store as a Backlog / In progress /
 * Parked / Done board. One PROJECT at a time (tab/←/→ or click cycles the
 * rolling selector), four full-height bordered columns matching the workspace
 * host's border grammar. Full-page swap like WorktreesPage: esc/ctrl+c
 * closes, `r` refetches, plus a light poll so
 * agent-driven moves (`kobe api issue-update --task`) show up while open.
 *
 * The BOARD stays read-only (agents move cards via `kobe api issue-*`); the
 * human surface is selection + the detail drawer (←↓↑→ moves the cursor,
 * Enter opens {@link IssueDetailDialog}, whose Start hands an
 * {@link IssueChatStart} to the host). Column math is framework-free
 * (`state/issue-board.ts`): done > parked > linked-task > backlog.
 *
 * This file owns the DATA and the ACTIONS — which boards exist, what is
 * selected, and every dialog/mutation behind `enter` / `n` / `d`. How many
 * lanes fit and how one is drawn is {@link KanbanBoard}'s job
 * (`component/kanban-board.tsx`); the only thing crossing that seam is the
 * measured board width.
 */

import { type BoxRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { RemoteOrchestrator, TaskEngineState } from "../../client/remote-orchestrator"
import { availableEngineIds } from "../../engine/account-detect"
import { engineDisplayName } from "../../engine/interactive-command"
import { errorMessage } from "../../lib/error-message"
import { applyBoardAttention, buildIssueBoard, moveBoardSelection } from "../../state/issue-board"
import { sidebarProjectLabel } from "../../tui/panes/sidebar/groups"
import type { VendorId } from "../../types/task"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { isNarrowWidth } from "../lib/narrow-mode"
import { useCursorFollow } from "../lib/use-cursor-follow"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { quickForkDefaultVendor } from "../workspace/quick-fork"
import type { IssueChatStart } from "../workspace/use-issue-chat"
import { IssueDetailDialog } from "./issue-detail-dialog"
import { KanbanBoard, needsSingleLane } from "./kanban-board"
import { type KanbanBoardEntry, useKanbanBoards } from "./use-kanban-boards"

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
  /** Per-task engine activity (host's `engineStateSignal`) — feeds the
   *  In-progress cards' live badges. */
  engineStates?: ReadonlyMap<string, TaskEngineState>
  /** Opened from a task (`c` on the sidebar row): land on THAT task's
   *  project and put the card cursor on its linked story, so the board
   *  opens already pointing at the work the task belongs to. */
  focusTask?: { readonly id: string; readonly repo: string }
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const dialog = useDialog()
  // Surface mutation failures as on-screen toasts: under an alternate screen
  // a bare console.error is invisible (it only reaches the daemon log), so a
  // failed create/delete would look like a silent no-op. taskId/tabId match
  // WorktreesPage — this page is not scoped to a single chat tab.
  const notif = useNotifications()
  function notifyError(message: string): void {
    notif.notify({ kind: "error", taskId: "", tabId: "", title: message })
  }
  // Below the narrow breakpoint four side-by-side columns degrade to
  // one-word-per-line strips, so the board shows ONE full-width lane there.
  const narrow = isNarrowWidth(useTerminalDimensions().width)
  // …and the terminal is not the board: the sidebar takes its share first.
  // Measure the page root (which is mounted in BOTH layouts — measuring the
  // four-lane box instead would unmount the thing being measured and
  // oscillate). `onSizeChange` + a ref is the tab-strip's pattern.
  const pageRef = useRef<BoxRenderable | null>(null)
  const [pageCells, setPageCells] = useState<number | null>(null)
  const singleLane = needsSingleLane(pageCells === null ? null : pageCells - PAGE_PADDING_CELLS) ?? narrow

  // Detected engines for the detail drawer's picker — one probe per page
  // open (account files on disk; cheap and refreshed enough).
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
  // One toast per DISTINCT set of read failures, not per render: the poll
  // refetches every POLL_MS and a still-broken repo must not re-toast. The key
  // is the errors themselves, so a NEW repo failing (or a different error on
  // the same repo) fires again while a persisting one stays quiet.
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
  // The task index decides In progress, not the link alone: the daemon
  // unlinks an issue when its task is deleted, but a store carried over from
  // a build that predates that can still hold a link to a task nobody has —
  // and such a card would sit In progress with no way back. Unresolvable =
  // Backlog, where the drawer offers Start again.
  //
  // An EMPTY index means "not loaded yet", never "every task is gone": the
  // page can render before the task list arrives, and demoting on that would
  // dump every In-progress card into Backlog for a frame. No tasks known ⇒
  // no predicate ⇒ the link alone decides, exactly as before.
  const knownTaskIds = new Set<string>((props.orchestrator?.listTasks() ?? []).map((task) => task.id))
  const { columns, attentionCount } = applyBoardAttention(
    activeBoard
      ? buildIssueBoard(activeBoard.issues, knownTaskIds.size === 0 ? undefined : (taskId) => knownTaskIds.has(taskId))
      : [],
    (taskId) => props.engineStates?.get(taskId)?.state,
  )

  // Cards are variable height and each lane scrolls on its own, so the
  // selection walks out of the viewport without this. One instance covers all
  // four lanes: `scrollChildIntoView` resolves the card through the lane's own
  // descendants and no-ops on the three that do not hold it.
  const follow = useCursorFollow(selectedId)

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

  // ←/→ select cards when any exist; tab still cycles projects. On an empty
  // board they fall through to project cycling, the same thing tab does.
  function moveOrCycle(dir: "left" | "right"): void {
    if (columns.some((column) => column.issues.length > 0)) moveCursor(dir)
    else cycleProject(dir === "left" ? -1 : 1)
  }

  /** Enter (or clicking the selected card): the story's detail drawer. Every
   *  outcome carries the drafted title/body — a dirty patch persists through
   *  `issue.mutate update` (best-effort: an edit must not block the start/open
   *  the user asked for). undefined = discarded (ctrl+c / backdrop). */
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
      // ONLY the fields the drawer actually changed. `issue` is the open-time
      // snapshot the drawer seeded its drafts from, so a field still equal to
      // it is one the user never touched — and writing it back would revert
      // whatever another client (an agent on `rove api issue-update`) put
      // there while the drawer sat open, silently, on a field the person
      // saving never saw. The store leaves an absent field alone, so fixing a
      // typo in the title now keeps a body rewritten underneath it.
      const patch: { title?: string; body?: string } = {}
      if (outcome.title !== issue.title) patch.title = outcome.title
      if (outcome.body !== issue.body) patch.body = outcome.body
      if (patch.title !== undefined || patch.body !== undefined) {
        await props.orchestrator
          ?.mutateIssue(board.repoRoot, { type: "update", id: issue.id, ...patch })
          .catch((err: unknown) => {
            // The reload below repaints from the store, so a rejected edit
            // leaves the card showing its OLD title — indistinguishable from
            // the edit never having been made.
            console.error("[rove kanban] issue update failed:", err)
            notifyError(t("kanban.updateFailed", { id: String(issue.id), error: errorMessage(err) }))
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

  /** `n` — the new-story intake: the detail drawer in create mode. ctrl+s
   *  files the story; enter/ctrl+enter files it AND starts it immediately
   *  at the chosen engine/placement (the web intake's Execute button). */
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

  /** `d` — delete the selected story after a confirm. Deletes ONLY the
   *  issue record; a linked task/branch/worktree is left untouched. */
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
    // Dormant while the detail drawer is up (the dialog owns the keyboard),
    // and while another pane has focus — the board shares the window with the
    // sidebar now, so its bare letters must not fire from over there.
    enabled: dialog.stack.length === 0 && props.focused !== false,
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

  /** One-line rolling project selector — tab/←/→ (or click) cycles, no tab
   *  row. Label stays flush with the page's left edge. The full path is a
   *  wide-layout nicety; narrow keeps only the label that identifies. */
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

  // One shared left baseline across rail pages: the root pads x=2 (the same
  // inset Routines / Issues / Versions / Worktrees use), so the Kanban title,
  // project selector, and board all start at x=2 — no per-child inset.
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
              {...(props.engineStates ? { engineStates: props.engineStates } : {})}
              follow={follow}
              onSelect={setSelectedId}
              onOpen={openDetail}
            />
          )}
        </>
      )}
    </box>
  )
}

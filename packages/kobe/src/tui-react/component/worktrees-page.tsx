/** @jsxImportSource @opentui/react */
/**
 * WorktreesPage — every git worktree across saved projects, kobe-managed or
 * not, with managed/age/dirty/pushed badges.
 *
 * Delete defers to the daemon's gate (`GitWorktreeManager.remove`): a clean
 * worktree deletes on one confirm; a dirty one fails the first attempt and
 * surfaces a second, more severe confirm before retrying with `force: true`.
 * No client-side dirty check.
 *
 * Delete is optimistic: `git worktree remove` with a populated `node_modules`
 * takes seconds, so the row hides on confirm and any failure restores it.
 *
 * Loading follows the async canon (`src/tui-react/history/host.tsx`): a
 * `reloadTick`-keyed effect with an effect-local `disposed` flag.
 */

import { TextAttributes } from "@opentui/core"
import { samePath } from "@sma1lboy/kobe-daemon/path-identity"
import { type ReactNode, useEffect, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { relativeAge } from "../../lib/relative-time"
import { DIRTY_WORKTREE_CODE } from "../../orchestrator/errors"
import { clampCursor } from "../../tui/component/new-task-dialog/state"
import type { WorktreeAuditRow, WorktreeProject } from "../../types/worktree"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { useCursorFollow } from "../lib/use-cursor-follow"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { resolveRowSelectionChrome } from "../ui/row-selection-chrome"
import { landTaskAction } from "../workspace/land-task-action"

function flattenRows(projects: readonly WorktreeProject[]): readonly WorktreeAuditRow[] {
  return projects.flatMap((p) => p.worktrees)
}

/**
 * Read a dirty refusal out of a daemon error, or `null`. The RPC layer keeps
 * only the message, so match the CODE (as `tui/lib/task-actions.ts` does):
 * `GitWorktreeManager.remove` refuses three ways (porcelain-dirty, `git status
 * --ignored` failed, gitignored work present) and all must reach the force
 * re-prompt. The returned reason names the gitignored paths when those
 * refused — `git status` can't show them.
 */
function dirtyRefusalReason(err: unknown): string | null {
  if (!(err instanceof Error)) return null
  const at = err.message.indexOf(DIRTY_WORKTREE_CODE)
  if (at < 0) return null
  return err.message.slice(at + DIRTY_WORKTREE_CODE.length).replace(/^:\s*/, "")
}

/** Match a worktree row's path to a tracked task id (loose realpath tolerance). */
function taskIdForPath(orch: RemoteOrchestrator, wtPath: string): string | undefined {
  const norm = (p: string): string => p.replace(/^\/private\//, "/")
  return orch.listTasks().find((task) => task.worktreePath && samePath(norm(task.worktreePath), norm(wtPath)))?.id
}

export function WorktreesPage(props: { orchestrator: RemoteOrchestrator | null; onClose: () => void }): ReactNode {
  const { theme } = useTheme()
  const dialog = useDialog()
  const t = useT()
  const notif = useNotifications()

  /**
   * Action outcomes as toasts: under the alternate screen `console.error` is
   * invisible. Empty taskId/tabId — the page isn't scoped to a chat tab.
   */
  function notifyError(message: string): void {
    notif.notify({ kind: "error", taskId: "", tabId: "", title: message })
  }
  function notifyNeedsInput(message: string): void {
    notif.notify({ kind: "needs_input", taskId: "", tabId: "", title: message })
  }
  function notifyInfo(message: string): void {
    notif.notify({ kind: "done", taskId: "", tabId: "", title: message })
  }

  const [projects, setProjects] = useState<readonly WorktreeProject[] | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const refetch = (): void => setReloadTick((tick) => tick + 1)

  // Two-phase load: local signals paint instantly; the full pass (ls-remote +
  // gh PR states, seconds on a slow remote) swaps in later. `fullLanded` stops
  // a late fast pass overwriting richer rows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick is a TRIGGER — the effect body doesn't read it.
  useEffect(() => {
    let disposed = false
    let fullLanded = false
    const orch = props.orchestrator
    if (!orch) {
      setProjects([])
      return
    }
    void orch
      .listWorktrees({ network: false })
      .then((rows) => {
        if (!disposed && !fullLanded) setProjects(rows)
      })
      .catch(() => {
        /* fast pass is best-effort; the full pass below still runs */
      })
    void orch
      .listWorktrees()
      .then((rows) => {
        fullLanded = true
        if (disposed) return
        setProjects(rows)
        // Unhide only confirmed-gone paths; a still-listed one is in flight or
        // failed, and the catch path un-hides those.
        const live = new Set(flattenRows(rows).map((r) => r.path))
        setRemovingPaths((paths) => paths.filter((p) => live.has(p)))
      })
      .catch(() => {
        // A failed read keeps the fast-pass rows or the placeholder.
      })
    return () => {
      disposed = true
    }
  }, [props.orchestrator, reloadTick])

  // Paths with a delete in flight: hidden, restored if the daemon call fails.
  const [removingPaths, setRemovingPaths] = useState<readonly string[]>([])
  const visibleProjects = (projects ?? []).map((p) => ({
    ...p,
    worktrees: p.worktrees.filter((w) => !removingPaths.includes(w.path)),
  }))
  const flatRows = flattenRows(visibleProjects)

  const [cursor, setCursor] = useState(0)
  // Re-clamp whenever the row count changes.
  useEffect(() => {
    setCursor((c) => clampCursor(c, flatRows.length))
  }, [flatRows.length])
  // Two-line rows in a scrolling page: keep the cursor in frame.
  const follow = useCursorFollow(cursor)

  const [busyPath, setBusyPath] = useState<string | null>(null)

  /** Hide the row, run the daemon delete in the background, restore on failure. */
  async function deleteInBackground(row: WorktreeAuditRow, force: boolean): Promise<void> {
    const orch = props.orchestrator
    if (!orch) return
    setRemovingPaths((paths) => [...paths, row.path])
    try {
      const residue = await orch.removeWorktree(row.path, force)
      // Deregistered but the directory stayed: not an error, but the only
      // place the leftover path is ever named.
      if (residue) notifyNeedsInput(t("worktrees.delete.residue", { path: residue.path, reason: residue.reason }))
      // Path stays in `removingPaths`: refetch is async, and dropping it here
      // would flash the dead row back until the fresh list lands.
      refetch()
    } catch (err) {
      setRemovingPaths((paths) => paths.filter((p) => p !== row.path))
      const reason = force ? null : dirtyRefusalReason(err)
      if (reason !== null) {
        const confirmed = await DialogConfirm.show(
          dialog,
          t("worktrees.delete.forceTitle"),
          `${t("worktrees.delete.forceBody", { branch: row.branch || row.path })}\n\n${t("worktrees.delete.forceReason", { reason })}`,
          t("common.cancel"),
          t("worktrees.delete.button"),
          { danger: true },
        )
        if (confirmed === true) await deleteInBackground(row, true)
        return
      }
      notifyError(t("worktrees.delete.failed", { error: String(err) }))
      console.error("[rove worktrees] delete failed:", err)
    }
  }

  async function requestDelete(row: WorktreeAuditRow): Promise<void> {
    if (!props.orchestrator || busyPath || removingPaths.includes(row.path)) return
    const ok = await DialogConfirm.show(
      dialog,
      t("worktrees.delete.confirmTitle"),
      t("worktrees.delete.confirmBody", { branch: row.branch || row.path }),
      t("common.cancel"),
      t("worktrees.delete.button"),
      { danger: true },
    )
    if (ok !== true) return
    void deleteInBackground(row, false)
  }

  async function requestLand(row: WorktreeAuditRow): Promise<void> {
    const orch = props.orchestrator
    if (!orch || busyPath) return
    const taskId = taskIdForPath(orch, row.path)
    if (!taskId) {
      notifyError(t("worktrees.land.noTask"))
      console.error("[rove worktrees] land refused: no tracked task for", row.path)
      return
    }
    // Landing is shared (`workspace/land-task-action.ts`); the page adds the
    // busy row and a refetch, since landing removes the worktree.
    setBusyPath(row.path)
    try {
      await landTaskAction(
        {
          orchestrator: orch,
          // Rendered by `landTaskAction` (destination + commit count).
          confirm: (body) =>
            DialogConfirm.show(
              dialog,
              t("worktrees.land.confirmTitle"),
              body,
              t("common.cancel"),
              t("worktrees.land.button"),
            ).then((ok) => ok === true),
          notifyInfo,
          notifyNeedsInput,
          notifyError,
          t,
          callerCwd: process.cwd(),
        },
        taskId,
        row.branch || row.path,
      )
      refetch()
    } finally {
      setBusyPath(null)
    }
  }

  useBindings(() => ({
    enabled: dialog.stack.length === 0,
    bindings: [
      ...pageCloseBindings(props.onClose),
      { key: "up", cmd: () => setCursor((c) => clampCursor(c - 1, flatRows.length)) },
      { key: "k", cmd: () => setCursor((c) => clampCursor(c - 1, flatRows.length)) },
      { key: "down", cmd: () => setCursor((c) => clampCursor(c + 1, flatRows.length)) },
      { key: "j", cmd: () => setCursor((c) => clampCursor(c + 1, flatRows.length)) },
      {
        key: "d",
        cmd: () => {
          const row = flatRows[cursor]
          if (row) void requestDelete(row)
        },
      },
      {
        key: "l",
        cmd: () => {
          const row = flatRows[cursor]
          if (row) void requestLand(row)
        },
      },
    ],
  }))

  function remoteBadge(status: boolean | null): ReactNode {
    if (status === true) return <text fg={theme.success}> {t("worktrees.badge.remoteOn")}</text>
    if (status === false) return <text fg={theme.warning}> {t("worktrees.badge.remoteOff")}</text>
    return <text fg={theme.textMuted}> {t("worktrees.badge.remoteUnknown")}</text>
  }

  /** Staleness badge (`orchestrator/worktree/staleness.ts`); `dirty` and `fresh` don't repeat here. */
  function verdictBadge(row: WorktreeAuditRow): ReactNode {
    if (row.verdictReason === "dirty" || row.verdictReason === "fresh") return null
    const fg = row.verdict === "merged" ? theme.success : row.verdict === "stale" ? theme.warning : theme.accent
    return <text fg={fg}> {t(`worktrees.verdict.${row.verdictReason}`)}</text>
  }

  const loading = projects === null
  let rowBase = 0

  return (
    <scrollbox
      ref={follow.scrollRef}
      flexGrow={1}
      backgroundColor={theme.background}
      paddingTop={1}
      paddingLeft={2}
      paddingRight={2}
      paddingBottom={1}
      verticalScrollbarOptions={{ trackOptions: { foregroundColor: "transparent" } }}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {t("worktrees.title")}
        </text>
      </box>

      {loading ? (
        <text fg={theme.textMuted}>{t("worktrees.loading")}</text>
      ) : visibleProjects.length === 0 ? (
        <text fg={theme.textMuted}>{t("worktrees.noProjects")}</text>
      ) : (
        visibleProjects.map((project) => {
          const base = rowBase
          rowBase += project.worktrees.length
          return (
            <box key={project.repo} gap={0} paddingTop={1}>
              <text fg={theme.textMuted} wrapMode="none">
                {project.repo}
              </text>
              {project.worktrees.length === 0 ? (
                <text fg={theme.textMuted} wrapMode="none">
                  {t("worktrees.noWorktrees")}
                </text>
              ) : (
                project.worktrees.map((row, i) => {
                  const absoluteIndex = base + i
                  const isCursor = absoluteIndex === cursor
                  // Shared cursor chrome; `▸` is reserved for "collapsed".
                  const chrome = resolveRowSelectionChrome(theme, { cursor: isCursor })
                  return (
                    <box
                      key={row.path}
                      ref={follow.rowRef(absoluteIndex)}
                      gap={0}
                      backgroundColor={chrome.backgroundColor}
                      onMouseUp={() => setCursor(absoluteIndex)}
                    >
                      <box flexDirection="row">
                        <text fg={chrome.markerColor} wrapMode="none">
                          {chrome.marker}
                        </text>
                        <text fg={theme.text} attributes={isCursor ? TextAttributes.BOLD : undefined} wrapMode="none">
                          {` ${row.branch || t("worktrees.row.detached")}`}
                        </text>
                        {row.kobeManaged ? <text fg={theme.textMuted}> {t("worktrees.badge.kobeManaged")}</text> : null}
                        {row.dirty === true ? <text fg={theme.warning}> {t("worktrees.badge.dirty")}</text> : null}
                        {/* `null` = the status probe FAILED. It reads as its own
                            badge, not as the absence of "dirty": a worktree whose
                            git answers "Permission denied" still holds whatever it
                            held, and this row is where a user decides to delete it. */}
                        {row.dirty === null ? (
                          <text fg={theme.textMuted}> {t("worktrees.badge.dirtyUnknown")}</text>
                        ) : null}
                        {remoteBadge(row.branchOnRemote)}
                        {verdictBadge(row)}
                        {busyPath === row.path ? <text fg={theme.textMuted}> …</text> : null}
                      </box>
                      <box flexDirection="row">
                        <text fg={chrome.markerColor} wrapMode="none">
                          {chrome.marker}
                        </text>
                        <box flexDirection="row" justifyContent="space-between" flexGrow={1} paddingLeft={1}>
                          <text fg={theme.textMuted} wrapMode="none">
                            {row.path}
                          </text>
                          {row.createdAtMs > 0 ? (
                            <text fg={theme.textMuted} wrapMode="none">
                              {t("worktrees.row.created", { age: relativeAge(row.createdAtMs) })}
                            </text>
                          ) : null}
                        </box>
                      </box>
                    </box>
                  )
                })
              )}
            </box>
          )
        })
      )}
    </scrollbox>
  )
}

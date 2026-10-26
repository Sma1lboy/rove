/**
 * Row-menu task verbs that are more than one request: land (preflight, then a confirm that
 * names the destination and the commit count), sync with base, fix failing checks, archive,
 * forget a project. Outcomes and copy are the TUI's (`land-task-action.ts`, `sync-base-action.ts`,
 * `use-fix-ci.ts`), read from its own catalogs.
 */

import type { TabRow, TaskRow } from "rove-bridge/protocol"
import { BridgeRequestError } from "./bridge.ts"
import { ConfirmDialog, errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { rowTitle } from "./rail.ts"
import { tc } from "./tui-copy.ts"
import { dialog, toast } from "./ui.ts"

interface LandPreflight {
  readonly landedOn: string
  readonly ahead?: number
  readonly refusal?: string
  readonly message?: string
}

const LAND_CONFLICT = /LAND_CONFLICT/
const MAIN_DIRTY = /MAIN_CHECKOUT_DIRTY/
const SYNC_CONFLICT = /SYNC_CONFLICT(?:: )?(.*)/
const SYNC_DIRTY = /SYNC_WORKTREE_DIRTY(?:: )?(.*)/

/** The TUI's wording for each land failure that has actionable copy. */
export function landErrorText(err: unknown): string {
  const msg = errorText(err)
  if (LAND_CONFLICT.test(msg)) return tc("worktrees", "land.conflict", { files: msg })
  if (MAIN_DIRTY.test(msg)) return tc("worktrees", "land.dirtyBase")
  return tc("worktrees", "land.failed", { error: msg })
}

/**
 * Preflight first, so a refusal (dirty base, empty branch) replaces the dialog instead of following a confirm.
 * `onLanded` runs after a successful land (the Worktrees page refetches its list).
 */
export async function landFlow(
  model: AppModel,
  task: Pick<TaskRow, "id" | "title" | "branch" | "machine">,
  onLanded?: () => void,
): Promise<void> {
  if (task.machine) {
    publishFlow(model, task, task.machine.label, onLanded)
    return
  }
  let probe: LandPreflight
  try {
    probe = await model.client.request<LandPreflight>("task.landPreflight", { taskId: task.id })
  } catch (err) {
    toast(tc("worktrees", "land.failed", { error: errorText(err) }), "error")
    return
  }
  if (probe.refusal) {
    toast(
      probe.refusal === "MAIN_CHECKOUT_DIRTY"
        ? tc("worktrees", "land.dirtyBase")
        : tc("worktrees", "land.failed", { error: probe.message ?? probe.refusal }),
      "error",
    )
    return
  }
  const branch = task.branch || task.title
  dialog.set(
    <ConfirmDialog
      title={tc("worktrees", "land.confirmTitle")}
      body={tc("worktrees", probe.ahead === 1 ? "land.confirmBodyOne" : "land.confirmBody", {
        branch,
        landedOn: probe.landedOn,
        // Never invent a count: `?` only when git printed a non-number.
        commits: probe.ahead ?? "?",
      })}
      confirmLabel={tc("worktrees", "land.button")}
      onConfirm={async () => {
        try {
          const res = await model.client.request<{ landedOn: string; commit: string }>("task.land", {
            taskId: task.id,
          })
          toast(tc("worktrees", "land.done", { branch, landedOn: res.landedOn, commit: res.commit.slice(0, 8) }))
          onLanded?.()
        } catch (err) {
          throw new Error(landErrorText(err))
        }
      }}
    />,
  )
}

/**
 * Landing a task that lives on another machine: there is no base checkout of it here to merge
 * into, so its branch is pushed from that machine and a PR opened (`publish`).
 */
function publishFlow(
  model: AppModel,
  task: Pick<TaskRow, "id" | "title" | "branch">,
  host: string,
  onLanded?: () => void,
): void {
  const branch = task.branch || task.title
  dialog.set(
    <ConfirmDialog
      title={t("taskops.publishTitle")}
      body={t("taskops.publishBody", { branch, host })}
      confirmLabel={t("taskops.publishButton")}
      onConfirm={async () => {
        const res = await model.client.request<{
          published?: { prUrl: string | null; prError: string | null }
        }>("task.land", { taskId: task.id })
        const pr = res.published?.prUrl
        if (pr) toast(t("taskops.publishedPr", { branch, url: pr }))
        else toast(t("taskops.publishedNoPr", { branch, reason: firstLine(res.published?.prError ?? "") }), "error")
        onLanded?.()
      }}
    />,
  )
}

/** No confirm: a merge from base is additive and `git merge --abort` undoes it. */
export async function syncBaseFlow(model: AppModel, taskId: string): Promise<void> {
  try {
    const res = await model.client.request<{ baseRef: string; alreadyCurrent: boolean }>("task.syncBase", { taskId })
    toast(tc("tasks", res.alreadyCurrent ? "sync.alreadyCurrent" : "sync.done", { base: res.baseRef }))
  } catch (err) {
    const msg = errorText(err)
    const conflict = SYNC_CONFLICT.exec(msg)
    const dirty = SYNC_DIRTY.exec(msg)
    if (conflict) toast(tc("tasks", "sync.conflict", { files: conflict[1]?.trim() || "?" }), "error")
    else if (dirty) toast(tc("tasks", "sync.dirty", { files: dirty[1]?.trim() || "?" }), "error")
    else toast(tc("tasks", "sync.failed", { error: msg }), "error")
  }
}

/** `gh`'s stderr is multi-line (an error plus hints); a toast gets one line. */
function firstLine(detail: string): string {
  return (
    detail
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? detail.trim()
  )
}

/** Feed the failing CI logs to the task's engine; the prompt rides the bridge, never the page. */
export async function fixChecksFlow(model: AppModel, taskId: string, sent: string): Promise<void> {
  try {
    const res = await model.client.request<{ outcome: "sent" | "none" | "unavailable"; detail?: string }>(
      "task.fixChecks",
      model.engineTarget(taskId),
    )
    if (res.outcome === "unavailable") {
      toast(tc("files", "toast.ciChecksUnavailable", { detail: firstLine(res.detail ?? "") }), "error")
    } else if (res.outcome === "none") toast(tc("files", "toast.ciNoFailingChecks"), "error")
    else toast(sent)
  } catch (err) {
    toast(errorText(err), "error")
  }
}

/** `o`: the task's worktree in the Mac's editor. Silent on success, like the TUI; its two toasts for the rest. */
export async function openEditorFlow(model: AppModel, taskId: string): Promise<void> {
  try {
    const res = await model.client.request<{ outcome: "opened" | "noEditor" | "failed"; label?: string }>(
      "task.openEditor",
      { taskId },
    )
    if (res.outcome === "noEditor") toast(tc("tasks", "toast.noEditor"), "error")
    else if (res.outcome === "failed")
      toast(tc("tasks", "toast.openWorktreeFailed", { label: res.label ?? "" }), "error")
  } catch (err) {
    toast(tc("tasks", "toast.worktreeErrorGeneric", { message: errorText(err) }), "error")
  }
}

/** Direct children of a task, archived ones included: a cascade deletes those too. */
function childrenOf(model: AppModel, id: string): readonly TaskRow[] {
  const payload = model.tasks.get()
  return [...(payload?.tasks ?? []), ...(payload?.archived ?? [])].filter((task) => task.parentTaskId === id)
}

/**
 * Delete a task entry (and its worktree). The first attempt is not forced: a worktree with
 * uncommitted work is refused with DIRTY_WORKTREE and only then does the dialog ask for an
 * explicit force, naming the refusal, as the TUI's `deleteTaskFlow`. A `dir` task pins the
 * user's own directory, so only the entry goes. A task with child tasks offers both ends of the
 * daemon's choice: promote them (its default) or delete the whole subtree (`cascade`); a force
 * retry keeps whichever was picked.
 */
export function deleteTaskDialog(model: AppModel, task: Pick<TaskRow, "id" | "title" | "branch" | "kind">) {
  const children = childrenOf(model, task.id)
  const hasChildren = children.length > 0
  const remove = (opts: { readonly force?: true; readonly cascade?: true }) =>
    model.client.request("task.delete", { taskId: task.id, ...opts }).then(() => {})
  return (
    <ConfirmDialog
      title={
        hasChildren
          ? tc("tasks", "confirm.childrenTitle", { title: task.title, count: String(children.length) })
          : tc("tasks", task.kind === "dir" ? "confirm.deleteTitleDir" : "confirm.deleteTitle", { title: task.title })
      }
      body={
        hasChildren
          ? tc("tasks", "confirm.childrenBody")
          : tc("tasks", task.kind === "dir" ? "confirm.deleteBodyDir" : "confirm.deleteBodyTask")
      }
      confirmLabel={tc("tasks", hasChildren ? "confirm.childrenPromote" : "confirm.deleteConfirm")}
      onConfirm={() => remove({})}
      {...(hasChildren
        ? { secondary: { label: tc("tasks", "confirm.childrenCascade"), onConfirm: () => remove({ cascade: true }) } }
        : {})}
      escalate={{
        when: (err) => err instanceof BridgeRequestError && err.code === "DIRTY_WORKTREE",
        label: tc("tasks", "confirm.forceDeleteConfirm"),
        title: tc("tasks", "confirm.forceDeleteTitle", { title: task.title }),
        // The title already names the task; its raw id is noise in the refusal.
        body: (err) =>
          `${tc("worktrees", "delete.forceBody", { branch: task.branch || task.title })}\n\n${tc("worktrees", "delete.forceReason", { reason: errorText(err).replace(`task ${task.id} `, "") })}`,
        run: (cascade) => remove({ force: true, ...(cascade ? { cascade: true } : {}) }),
      }}
    />
  )
}

/**
 * A project's main checkout is never deleted (`task.delete` refuses it): its Delete ends the conversation —
 * every tab closes, so the sessions die — and the project stays listed, nothing on disk touched. With
 * children the dialog also offers to delete them first, each subtree as a normal delete (force retry included).
 */
export function endMainConversationDialog(model: AppModel, task: TaskRow) {
  const children = childrenOf(model, task.id)
  const hasChildren = children.length > 0
  const title = rowTitle(task, model.tabs.get()[task.id])
  const endConversation = async () => {
    const { tabs } = await model.client.request<{ tabs: readonly TabRow[] }>("task.tabs", { taskId: task.id })
    for (const tab of tabs) await model.client.request("tab.close", { taskId: task.id, tabId: tab.id })
    await model.refreshTabsNow()
  }
  // The child whose delete was refused, so the force confirm names it rather than the project.
  let blocked: string | undefined
  const endWithChildren = async (force: boolean) => {
    for (const child of children) {
      try {
        await model.client.request("task.delete", {
          taskId: child.id,
          cascade: true,
          ...(force ? { force: true } : {}),
        })
      } catch (err) {
        blocked = child.title
        throw err
      }
    }
    await endConversation()
  }
  return (
    <ConfirmDialog
      title={
        hasChildren
          ? tc("tasks", "confirm.childrenTitle", { title, count: String(children.length) })
          : tc("tasks", "confirm.deleteTitleDir", { title })
      }
      body={tc("tasks", hasChildren ? "confirm.childrenBodyMain" : "confirm.deleteBodyMain")}
      confirmLabel={tc("tasks", hasChildren ? "confirm.childrenKeepMain" : "confirm.deleteConfirm")}
      onConfirm={endConversation}
      {...(hasChildren
        ? { secondary: { label: tc("tasks", "confirm.childrenCascadeMain"), onConfirm: () => endWithChildren(false) } }
        : {})}
      escalate={{
        when: (err) => err instanceof BridgeRequestError && err.code === "DIRTY_WORKTREE",
        label: tc("tasks", "confirm.forceDeleteConfirm"),
        title: tc("tasks", "confirm.forceDeleteTitle", { title }),
        body: (err) => `${tc("worktrees", "delete.forceBody", { branch: blocked ?? title })}\n\n${errorText(err)}`,
        run: () => endWithChildren(true),
      }}
    />
  )
}

/**
 * Row menu Archive / Unarchive (`archive-task-action.ts`): hide or restore the task and its children.
 * No confirm, since nothing stops; only the daemon's TASK_BUSY refusal (an engine still working or
 * waiting on you) asks once, and "Archive anyway" retries with force.
 */
export async function archiveFlow(model: AppModel, task: Pick<TaskRow, "id" | "title" | "archived">): Promise<void> {
  const archived = task.archived !== true
  const title = task.title
  const run = async (force: boolean) => {
    await model.client.request("task.archive", { taskId: task.id, archived, ...(force ? { force: true } : {}) })
    toast(tc("tasks", archived ? "archive.done" : "archive.restored", { title }))
  }
  try {
    await run(false)
  } catch (err) {
    if (archived && err instanceof BridgeRequestError && err.code === "TASK_BUSY") {
      dialog.set(
        <ConfirmDialog
          title={tc("tasks", "archive.busyTitle")}
          body={tc("tasks", "archive.busyBody", { title })}
          confirmLabel={tc("tasks", "archive.busyConfirm")}
          onConfirm={() => run(true)}
        />,
      )
      return
    }
    toast(tc("tasks", archived ? "archive.failed" : "archive.restoreFailed", { error: errorText(err) }), "error")
  }
}

/** The project row's Delete: the repo and its tasks stay on disk, only the list entry goes. */
export function forgetProjectDialog(model: AppModel, repo: string, title: string) {
  return (
    <ConfirmDialog
      title={tc("tasks", "confirm.forgetProjectTitle", { title })}
      body={tc("tasks", "confirm.forgetProjectBody")}
      confirmLabel={tc("tasks", "confirm.forgetProjectConfirm")}
      onConfirm={async () => {
        try {
          await model.client.request("project.forget", { repo })
        } catch (err) {
          throw new Error(tc("tasks", "toast.forgetProjectFailed", { error: errorText(err) }))
        }
      }}
    />
  )
}

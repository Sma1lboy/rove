/**
 * Right-click menus for rail rows, in the TUI's order (`tui/panes/sidebar/
 * tree-menu.ts`): tab rows add Close tab, task rows carry the task verbs,
 * project headers carry the project verbs. A verb with a rail key names its TUI binding id,
 * so the key that runs it and the chord shown beside it are the user's (`keybindings.yaml`).
 */

import { legendCap } from "@sma1lboy/rove/src/tui/lib/help-groups.ts"
import type { TabRow, TaskRow } from "rove-bridge/protocol"
import { ConfirmDialog, TextDialog } from "./dialogs.tsx"
import { ChangeEngineDialog } from "./engine-dialog.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { moveMode } from "./move-mode.ts"
import { NewChatDialog } from "./new-chat-dialog.tsx"
import { NewTaskDialog } from "./new-task-dialog.tsx"
import { openTab } from "./task-dialogs.tsx"
import {
  deleteTaskDialog,
  fixChecksFlow,
  forgetProjectDialog,
  landFlow,
  openEditorFlow,
  syncBaseFlow,
} from "./task-flows.tsx"
import { FieldNotesDialog, RunAgainDialog } from "./taskops-dialogs.tsx"
import { tc } from "./tui-copy.ts"
import { type MenuItem, dialog, toast } from "./ui.ts"
import { prefixHint } from "./user-keys.ts"

const STATUSES = ["backlog", "in_progress", "in_review", "done", "canceled", "error"] as const
const STATUS_KEYS: Record<(typeof STATUSES)[number], string> = {
  backlog: "status.backlog",
  in_progress: "status.inProgress",
  in_review: "status.inReview",
  done: "status.done",
  canceled: "status.canceled",
  error: "status.error",
}

/** A menu entry that mirrors a rail key: the binding it runs by, and the chord it shows. */
const bound = (binding: string): Pick<MenuItem, "binding" | "key"> => ({
  binding,
  key: legendCap(binding) ?? undefined,
})

async function copy(text: string | null | undefined, what: string): Promise<void> {
  if (!text) {
    toast(t("menu.nothingToCopy", { what }), "error")
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    toast(t("menu.copied", { text }))
  } catch {
    toast(t("menu.copyFailed"), "error")
  }
}

/** What a project header knows about its place in the rail: the main checkout stands in for the project in moves. */
export interface ProjectInfo {
  readonly mainTaskId: string | null
  readonly label: string
  /** Already the topmost movable project, so "Move to top" would be dead. */
  readonly first: boolean
}

export function projectMenu(model: AppModel, repo: string, info: ProjectInfo): MenuItem[] {
  const items: MenuItem[] = [
    { label: t("menu.newTask"), section: "open", run: () => dialog.set(<NewTaskDialog model={model} repo={repo} />) },
  ]
  const main = info.mainTaskId
  if (main) {
    if (!info.first) {
      items.push({
        label: tc("tasks", "menu.moveToTop"),
        section: "edit",
        run: () =>
          void model.client
            .request("task.move", { taskId: main, direction: "top" })
            .catch((e) => toast(tc("tasks", "toast.moveFailed", { error: String(e) }), "error")),
      })
    }
    items.push({
      label: tc("tasks", "menu.reorderProject"),
      section: "edit",
      ...bound("sidebar.localMerge"),
      run: () => enterMoveMode(),
    })
  }
  items.push({
    label: tc("tasks", "menu.fieldNotes"),
    section: "notes",
    run: () => dialog.set(<FieldNotesDialog model={model} repo={repo} />),
  })
  if (main) {
    items.push({
      label: tc("tasks", "menu.forgetProject"),
      section: "danger",
      danger: true,
      ...bound("sidebar.delete"),
      run: () => dialog.set(forgetProjectDialog(model, repo, info.label)),
    })
  }
  return items
}

/** Shift+M / "Reorder": j/k then move the cursor row at its level; the rail owns the keys, so hand it focus. */
function enterMoveMode(): void {
  moveMode.set(!moveMode.get())
  document.querySelector<HTMLElement>(".rail")?.focus()
}

export function taskMenu(model: AppModel, task: TaskRow, tab: TabRow | null): MenuItem[] {
  const c = model.client
  const items: MenuItem[] = []
  if (tab) {
    items.push({
      label: t("menu.closeTab"),
      section: "tab",
      run: () =>
        dialog.set(
          <ConfirmDialog
            title={t("confirm.closeTabTitle", { tab: tab.title ?? tab.engineName ?? tab.id })}
            body={t("confirm.closeTabBody")}
            confirmLabel={t("menu.closeTab")}
            onConfirm={async () => {
              await c.request("tab.close", { taskId: task.id, tabId: tab.id })
              await model.refreshTabsNow()
            }}
          />,
        ),
    })
  }

  // Open: what starts work in this task.
  items.push({
    label: t("menu.newChat"),
    section: "open",
    run: () => dialog.set(<NewChatDialog model={model} taskId={task.id} />),
  })
  items.push({
    label: t("menu.newShell"),
    section: "open",
    run: () => void openTab(model, task.id, { kind: "shell" }).catch((e) => toast(String(e), "error")),
  })
  if (task.hasPrompt) {
    items.push({
      label: tc("tasks", "menu.runAgain"),
      section: "open",
      run: () => dialog.set(<RunAgainDialog model={model} task={task} />),
    })
  }
  // A task on another machine runs its verbs there; what only this machine can do stays off its menu:
  // an editor on its files, the local rail order, and this machine's engine list.
  const local = !task.machine
  if (local) {
    items.push({
      label: tc("tasks", "menu.openEditor"),
      section: "open",
      ...bound("tasks.openWorktree"),
      run: () => void openEditorFlow(model, task.id),
    })
  }

  // Edit: the task's own fields and place in the rail.
  items.push({
    label: t("menu.rename"),
    section: "edit",
    ...bound("sidebar.rename"),
    run: () =>
      dialog.set(
        <TextDialog
          title={t("menu.rename")}
          initial={task.title}
          submitLabel={t("dialog.save")}
          onSubmit={(title) => c.request("task.rename", { taskId: task.id, title }).then(() => {})}
        />,
      ),
  })
  if (task.kind !== "main") {
    items.push({
      label: task.pinned ? t("menu.unpin") : t("menu.pin"),
      section: "edit",
      ...bound("sidebar.pin"),
      run: () =>
        void c.request("task.pin", { taskId: task.id, pinned: !task.pinned }).catch((e) => toast(String(e), "error")),
    })
  }
  if (local) {
    items.push({
      label: tc("tasks", "menu.reorder"),
      section: "edit",
      ...bound("sidebar.localMerge"),
      run: () => enterMoveMode(),
    })
  }
  items.push({
    label: t("menu.setStatus"),
    section: "edit",
    children: STATUSES.map(
      (s): MenuItem => ({
        label: t(STATUS_KEYS[s]),
        checked: s === task.status,
        run: () =>
          void c.request("task.setStatus", { taskId: task.id, status: s }).catch((e) => toast(String(e), "error")),
      }),
    ),
  })
  if (local) {
    items.push({
      label: t("menu.changeEngine"),
      section: "edit",
      // The menu picks; the key cycles (TUI: `tasks.cycleEngine` hint on the picker entry).
      ...bound("tasks.cycleEngine"),
      run: () => dialog.set(<ChangeEngineDialog model={model} taskId={task.id} />),
    })
  }

  // Git: the branch and its PR.
  if (task.pr?.checkState === "failing") {
    items.push({
      label: tc("tasks", "menu.fixChecks"),
      section: "git",
      key: prefixHint("files.fixChecks"),
      run: () => void fixChecksFlow(model, task.id, t("taskops.fixSent")),
    })
  }
  if (task.kind === "task" && task.branch) {
    items.push({
      label: tc("tasks", "menu.syncBase"),
      section: "git",
      key: prefixHint("files.syncBase"),
      run: () => void syncBaseFlow(model, task.id),
    })
  }
  if (task.branch) {
    items.push({
      label: t("menu.renameBranch"),
      section: "git",
      ...bound("tasks.renameBranch"),
      run: () =>
        dialog.set(
          <TextDialog
            title={t("menu.renameBranch")}
            initial={task.branch}
            submitLabel={t("dialog.save")}
            onSubmit={(branch) => c.request("task.setBranch", { taskId: task.id, branch }).then(() => {})}
          />,
        ),
    })
  }
  if (task.kind === "task" && task.branch) {
    items.push({ label: t("menu.land"), section: "git", run: () => void landFlow(model, task) })
  }

  // Copy: one entry, its choices a level down.
  const copies: MenuItem[] = [{ label: t("menu.copyWhat.id"), run: () => void copy(task.id, t("menu.what.id")) }]
  if (task.branch)
    copies.push({ label: t("menu.copyWhat.branch"), run: () => void copy(task.branch, t("menu.what.branch")) })
  copies.push({
    label: t("menu.copyWhat.path"),
    run: () =>
      void c
        .request<{ task: { worktreePath?: string } }>("task.get", { taskId: task.id })
        .then((res) => copy(res.task.worktreePath, t("menu.what.path")))
        .catch((e) => toast(String(e), "error")),
  })
  items.push({ label: t("menu.copy"), section: "copy", children: copies })

  items.push({
    label: t("menu.delete"),
    section: "danger",
    ...bound("sidebar.delete"),
    danger: true,
    run: () =>
      // A project's main checkout has no worktree to delete: Delete forgets the project (TUI `deleteTaskFlow`).
      task.kind === "main"
        ? dialog.set(forgetProjectDialog(model, task.repo, task.title))
        : dialog.set(deleteTaskDialog(model, task)),
  })
  return items
}

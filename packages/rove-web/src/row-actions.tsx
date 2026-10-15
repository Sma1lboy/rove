/**
 * Right-click menus for rail rows, in the TUI's order (`tui/panes/sidebar/
 * tree-menu.ts`): tab rows add Close tab, task rows carry the task verbs,
 * project headers carry the project verbs. Open in editor is left out rather than
 * shown dead; PARITY.md lists it.
 */

import type { TabRow, TaskRow } from "rove-bridge/protocol"
import { type Choice, ChoiceDialog, ConfirmDialog, TextDialog } from "./dialogs.tsx"
import { ChangeEngineDialog } from "./engine-dialog.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { moveMode } from "./move-mode.ts"
import { NewTaskDialog } from "./new-task-dialog.tsx"
import { NewChatDialog, openTab } from "./task-dialogs.tsx"
import { deleteTaskDialog, fixChecksFlow, forgetProjectDialog, landFlow, syncBaseFlow } from "./task-flows.tsx"
import { FieldNotesDialog, RunAgainDialog } from "./taskops-dialogs.tsx"
import { tc } from "./tui-copy.ts"
import { type MenuItem, dialog, toast } from "./ui.ts"

const STATUSES = ["backlog", "in_progress", "in_review", "done", "canceled", "error"] as const
const STATUS_KEYS: Record<(typeof STATUSES)[number], string> = {
  backlog: "status.backlog",
  in_progress: "status.inProgress",
  in_review: "status.inReview",
  done: "status.done",
  canceled: "status.canceled",
  error: "status.error",
}

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
    { label: t("menu.newTask"), run: () => dialog.set(<NewTaskDialog model={model} repo={repo} />) },
  ]
  const main = info.mainTaskId
  if (main) {
    if (!info.first) {
      items.push({
        label: tc("tasks", "menu.moveToTop"),
        run: () =>
          void model.client
            .request("task.move", { taskId: main, direction: "top" })
            .catch((e) => toast(tc("tasks", "toast.moveFailed", { error: String(e) }), "error")),
      })
    }
    items.push({ label: tc("tasks", "menu.reorderProject"), key: "M", run: () => enterMoveMode() })
  }
  items.push({
    label: tc("tasks", "menu.fieldNotes"),
    run: () => dialog.set(<FieldNotesDialog model={model} repo={repo} />),
  })
  if (main) {
    items.push({
      label: tc("tasks", "menu.forgetProject"),
      danger: true,
      key: "d",
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
  items.push({ label: t("menu.newChat"), run: () => dialog.set(<NewChatDialog model={model} taskId={task.id} />) })
  items.push({
    label: t("menu.newShell"),
    run: () => void openTab(model, task.id, { kind: "shell" }).catch((e) => toast(String(e), "error")),
  })
  items.push({
    label: t("menu.rename"),
    key: "r",
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
      key: "P",
      run: () =>
        void c.request("task.pin", { taskId: task.id, pinned: !task.pinned }).catch((e) => toast(String(e), "error")),
    })
  }
  items.push({ label: tc("tasks", "menu.reorder"), key: "M", run: () => enterMoveMode() })
  if (task.hasPrompt) {
    items.push({
      label: tc("tasks", "menu.runAgain"),
      run: () => dialog.set(<RunAgainDialog model={model} task={task} />),
    })
  }
  items.push({
    label: t("menu.setStatus"),
    run: () =>
      dialog.set(
        <ChoiceDialog
          title={t("menu.setStatus")}
          current={task.status}
          choices={STATUSES.map((s): Choice => ({ value: s, label: t(STATUS_KEYS[s]) }))}
          onPick={(status) => c.request("task.setStatus", { taskId: task.id, status }).then(() => {})}
        />,
      ),
  })
  items.push({ label: t("menu.copyId"), run: () => void copy(task.id, t("menu.what.id")) })
  if (task.branch) items.push({ label: t("menu.copyBranch"), run: () => void copy(task.branch, t("menu.what.branch")) })
  items.push({
    label: t("menu.copyPath"),
    run: () =>
      void c
        .request<{ task: { worktreePath?: string } }>("task.get", { taskId: task.id })
        .then((res) => copy(res.task.worktreePath, t("menu.what.path")))
        .catch((e) => toast(String(e), "error")),
  })
  if (task.branch) {
    items.push({
      label: t("menu.renameBranch"),
      key: "b",
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
  items.push({
    label: t("menu.changeEngine"),
    // The menu picks; the key cycles (TUI: `tasks.cycleEngine` hint on the picker entry).
    key: "v",
    run: () => dialog.set(<ChangeEngineDialog model={model} taskId={task.id} />),
  })
  if (task.pr?.checkState === "failing") {
    items.push({
      label: tc("tasks", "menu.fixChecks"),
      key: "ctrl+a k",
      run: () => void fixChecksFlow(model, task.id, t("taskops.fixSent")),
    })
  }
  if (task.kind === "task" && task.branch) {
    items.push({ label: tc("tasks", "menu.syncBase"), key: "ctrl+a u", run: () => void syncBaseFlow(model, task.id) })
  }
  if (task.kind === "task" && task.branch) {
    items.push({ label: t("menu.land"), run: () => void landFlow(model, task) })
  }
  items.push({
    label: t("menu.delete"),
    key: "d",
    danger: true,
    run: () =>
      // A project's main checkout has no worktree to delete: Delete forgets the project (TUI `deleteTaskFlow`).
      task.kind === "main"
        ? dialog.set(forgetProjectDialog(model, task.repo, task.title))
        : dialog.set(deleteTaskDialog(model, task)),
  })
  return items
}

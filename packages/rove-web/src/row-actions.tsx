/**
 * Right-click menus for rail rows, in the TUI's order (`tui/panes/sidebar/
 * tree-menu.ts`): tab rows add Close tab, task rows carry the task verbs,
 * project headers start a task. Entries the bridge cannot carry (Open in
 * editor, Reorder, Run again, Fix checks, Sync base) are left out
 * rather than shown dead; PARITY.md lists them.
 */

import type { TabRow, TaskRow } from "rove-bridge/protocol"
import { type Choice, ChoiceDialog, ConfirmDialog, TextDialog } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { NewChatDialog, NewTaskDialog, openTab } from "./task-dialogs.tsx"
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

export function projectMenu(model: AppModel, repo: string): MenuItem[] {
  return [{ label: t("menu.newTask"), run: () => dialog.set(<NewTaskDialog model={model} repo={repo} />) }]
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
    run: () =>
      void c
        .request<{ engines: Array<{ id: string; name: string }> }>("engines.list")
        .then((res) =>
          dialog.set(
            <ChoiceDialog
              title={t("menu.changeEngine")}
              current={task.engine?.id ?? undefined}
              choices={res.engines.map((e) => ({ value: e.id, label: e.name }))}
              onPick={(engine) => c.request("task.setCommand", { taskId: task.id, engine }).then(() => {})}
            />,
          ),
        ),
  })
  if (task.kind === "task" && task.branch) {
    items.push({
      label: t("menu.land"),
      run: () =>
        dialog.set(
          <ConfirmDialog
            title={t("confirm.landTitle", { title: task.title })}
            body={t("confirm.landBody", { branch: task.branch })}
            confirmLabel={t("menu.land")}
            onConfirm={async () => {
              const res = await c.request<{ landedOn: string; commit: string }>("task.land", { taskId: task.id })
              toast(t("confirm.landed", { base: res.landedOn, commit: res.commit.slice(0, 8) }))
            }}
          />,
        ),
    })
  }
  items.push({
    label: t("menu.delete"),
    key: "d",
    danger: true,
    run: () =>
      dialog.set(
        <ConfirmDialog
          title={t("confirm.deleteTitle", { title: task.title })}
          body={task.kind === "dir" ? t("confirm.deleteBodyDir") : t("confirm.deleteBodyTask")}
          confirmLabel={t("confirm.delete")}
          onConfirm={() => c.request("task.delete", { taskId: task.id }).then(() => {})}
          escalate={{
            when: (err) => String(err).includes("DIRTY"),
            label: t("confirm.forceDelete"),
            run: () => c.request("task.delete", { taskId: task.id, force: true }).then(() => {}),
          }}
        />,
      ),
  })
  return items
}

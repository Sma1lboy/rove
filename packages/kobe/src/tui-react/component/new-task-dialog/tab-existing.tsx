/** @jsxImportSource @opentui/react */
/**
 * Existing tab of the React new-task dialog (issue #15, G3W2) — pick an
 * existing local repo path + base branch. Direct port of the Solid
 * shell's existing-tab body: unified free-text repo input with the
 * saved/browse smart dropdown, branch picker that augments the input.
 * All behavior lives in the view-model; this file is JSX only.
 */

import { type ExistingIntent, splitRepoRow } from "../../../tui/component/new-task-dialog/state"
import { DEFAULT_BASE_REF } from "../../../tui/lib/git-snapshot"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { ChoiceRow, PickerList, labelStyle } from "./picker-list"
import type { NewTaskVm } from "./view-model"

export function ExistingTab({ vm }: { vm: NewTaskVm }) {
  const { theme } = useTheme()
  const t = useT()

  const repoRows = vm.activeWindow.items.map((name, i) => {
    const isCurrentDir = vm.mode === "saved" && name === vm.defaultRepo
    const tag = isCurrentDir ? `  ${t("newTask.hint.currentDir")}` : ""
    // Browse mode lists SUBDIRECTORY NAMES under the typed path, not full
    // paths — there is no prefix to demote, so those rows stay whole.
    if (vm.mode === "browse") {
      return { key: `${vm.activeWindow.start + i}:${name}`, body: `${name}/${tag}`, accent: false }
    }
    // Saved mode lists absolute paths that mostly share a prefix, so the one
    // word telling them apart is the basename — it leads, and the directory
    // trails muted (`splitRepoRow`).
    const { base, dir } = splitRepoRow(name)
    return {
      key: `${vm.activeWindow.start + i}:${name}`,
      body: `${base}${tag}`,
      accent: vm.repo.trim() === name,
      ...(dir ? { dim: dir } : {}),
    }
  })

  const branchRows = vm.branchWindow.items.map((name, i) => ({
    key: `${vm.branchWindow.start + i}:${name}`,
    body: name,
    accent: vm.baseRef.trim() === name,
  }))

  const intents: readonly ExistingIntent[] = ["task", "project"]
  const intentLabel: Record<ExistingIntent, string> = {
    task: t("newTask.intent.task"),
    project: t("newTask.intent.project"),
  }

  return (
    <>
      <box gap={0}>
        <text {...labelStyle(theme, vm.field, "repo")}>{t("newTask.field.repo")}</text>
        <input
          value={vm.repo}
          placeholder={vm.defaultRepo}
          focused={vm.field === "repo"}
          onMouseUp={() => vm.setField("repo")}
          onInput={(v: string) => vm.setRepoText(v)}
          // Every Enter routes through onRepoSubmit — it handles the
          // empty-input pick-first case too.
          onSubmit={() => vm.onRepoSubmit()}
        />
      </box>
      {vm.field === "repo" && vm.activeList.length > 0 && !vm.repoPicked ? (
        <PickerList window={vm.activeWindow} cursor={vm.repoCursor} rows={repoRows} onPick={vm.selectRepoAt} />
      ) : null}
      {/* Only for a repo that HAS a project checkout (issue #90). Everywhere
          else this row would be a control whose second option does nothing,
          so it stays absent rather than disabled. */}
      {vm.canOpenProject ? (
        <box gap={0} paddingBottom={1}>
          <text fg={theme.textMuted}>{t("newTask.field.opens")}</text>
          <ChoiceRow
            choices={intents}
            selected={vm.intent}
            onPick={(next) => vm.setIntent(next)}
            display={(choice) => intentLabel[choice]}
          />
        </box>
      ) : null}
      {/* Opening the project has no branch to fork from — it enters the
          repo's own checkout — so the field goes away with the verb. */}
      {vm.intent === "project" && vm.canOpenProject ? null : (
        <box gap={0}>
          <text {...labelStyle(theme, vm.field, "baseRef")}>{t("newTask.field.fromBranch")}</text>
          <input
            value={vm.baseRef}
            placeholder={DEFAULT_BASE_REF}
            focused={vm.field === "baseRef"}
            onMouseUp={() => vm.setField("baseRef")}
            onInput={(v: string) => vm.setBaseRefText(v)}
            // Last field on the tab — Enter resolves the highlighted branch
            // and creates straight away.
            onSubmit={() => vm.onBaseRefSubmit()}
          />
        </box>
      )}
      {vm.field === "baseRef" && vm.branchFiltered.length === 0 && vm.submitError == null ? (
        <box gap={0} paddingLeft={2} paddingBottom={1}>
          <text fg={theme.textMuted} wrapMode="none">
            {vm.branches.length === 0 ? t("newTask.hint.noBranchesFound") : t("newTask.hint.noMatchBranch")}
          </text>
        </box>
      ) : null}
      {vm.field === "baseRef" && vm.branchFiltered.length > 0 ? (
        <PickerList
          window={vm.branchWindow}
          cursor={vm.branchCursor}
          rows={branchRows}
          onPick={vm.pickBranchAt}
          paddingBottom={1}
        />
      ) : null}
    </>
  )
}

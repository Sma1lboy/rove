/** @jsxImportSource @opentui/react */
/**
 * Existing tab of the new-task dialog — pick an existing local repo path +
 * base branch: a unified free-text repo input with the saved/browse smart
 * dropdown, and a branch picker that augments the input. All behavior lives
 * in the view-model; this file is JSX only.
 */

import { type ExistingIntent, splitRepoRow } from "../../../tui/component/new-task-dialog/state"
import { DEFAULT_BASE_REF } from "../../../tui/lib/git-snapshot"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { ChipRow, DialogField, DialogSection } from "../../ui/dialog-parts"
import { PickerList } from "./picker-list"
import type { NewTaskVm } from "./view-model"

/**
 * Cells the repo input claims. Wide enough for a long repo name plus room to
 * type a path by hand; the muted directory takes whatever is left and shrinks
 * first, because it is the half the row can lose and stay identifiable.
 */
const REPO_INPUT_CELLS = 28

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
      accent: vm.expandedRepo === name,
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
      <DialogSection label={t("newTask.field.repo")} focused={vm.field === "repo"} onPress={() => vm.setField("repo")}>
        {/* Name left, directory right — the same weighting as the picker rows
            below, so a repo reads the same whether it is being chosen or has
            been. The input still holds the full path (`vm.repo`); only which
            half of it sits in the editable cell changes. */}
        <DialogField focused={vm.field === "repo"}>
          <box flexDirection="row">
            <input
              value={vm.repo}
              placeholder={splitRepoRow(vm.defaultRepo).base}
              focused={vm.field === "repo"}
              onMouseUp={() => vm.setField("repo")}
              onInput={(v: string) => vm.setRepoText(v)}
              // Every Enter routes through onRepoSubmit — it handles the
              // empty-input pick-first case too.
              onSubmit={() => vm.onRepoSubmit()}
              // Two shapes, because the field holds two kinds of value.
              //
              // Holding a NAME, there is a directory beside it and the row has
              // to divide: the input takes a fixed column and the directory is
              // what gives way. NOT `flexGrow` — the input would grow to the
              // row, the directory would then compress it below the name's
              // length, and an input narrower than its content scrolls to the
              // cursor, so `fixture-repo` renders as `ture-repo` with nothing
              // to admit the cut.
              //
              // Holding a PATH (typed by hand, or a name too ambiguous to show)
              // nothing sits beside it and it takes the whole row: a path needs
              // every cell it can get, and capping it at the name's column would
              // clip what the user is typing.
              flexGrow={vm.repoDir ? 0 : 1}
              flexShrink={0}
              {...(vm.repoDir ? { flexBasis: REPO_INPUT_CELLS } : {})}
            />
            {/* The separating space is INSIDE the string rather than
                `paddingLeft`: padding belongs to the box Yoga is shrinking, so a
                full row closes it to zero and the name runs into the path. */}
            {vm.repoDir ? (
              <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
                {` ${vm.repoDir}`}
              </text>
            ) : null}
          </box>
        </DialogField>
      </DialogSection>
      {vm.field === "repo" && vm.activeList.length > 0 && !vm.repoPicked ? (
        <PickerList window={vm.activeWindow} cursor={vm.repoCursor} rows={repoRows} onPick={vm.selectRepoAt} />
      ) : null}
      {/* Only for a repo that HAS a project checkout. Everywhere
          else this row would be a control whose second option does nothing,
          so it stays absent rather than disabled. */}
      {vm.canOpenProject ? (
        <DialogSection
          label={t("newTask.field.opens")}
          focused={vm.field === "intent"}
          hint="←/→"
          onPress={() => vm.setField("intent")}
        >
          <ChipRow
            choices={intents}
            selected={vm.intent}
            display={(choice) => intentLabel[choice]}
            onPick={(choice) => {
              vm.setIntent(choice)
              vm.setField("intent")
            }}
          />
        </DialogSection>
      ) : null}
      {/* Opening the project has no branch to fork from — it enters the
          repo's own checkout — so the field goes away with the verb. */}
      {vm.intent === "project" && vm.canOpenProject ? null : (
        <DialogSection
          label={t("newTask.field.fromBranch")}
          focused={vm.field === "baseRef"}
          onPress={() => vm.setField("baseRef")}
        >
          <DialogField focused={vm.field === "baseRef"}>
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
          </DialogField>
        </DialogSection>
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

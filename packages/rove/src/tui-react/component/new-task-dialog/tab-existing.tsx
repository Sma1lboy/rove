/** @jsxImportSource @opentui/react */
/** Existing tab: first message, repo input with saved/browse dropdown, base-branch picker.
 *  JSX only; behavior lives in the view-model. */

import { DEFAULT_BASE_REF } from "@sma1lboy/rove-core/worktree/git-snapshot.ts"
import { type ExistingIntent, splitRepoRow } from "../../../tui/component/new-task-dialog/state"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { ChipRow, DialogField, DialogSection } from "../../ui/dialog-parts"
import { INPUT_SCROLL } from "../../ui/input-scroll"
import { FolderPickerCard } from "./folder-picker-card"
import { PickerList } from "./picker-list"
import type { NewTaskVm } from "./view-model"

/** `only`: render just the focused field (the composer layout shows the rest as chips). */
export function ExistingTab({ vm, only }: { vm: NewTaskVm; only?: boolean }) {
  const { theme } = useTheme()
  const t = useT()

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
      {only && vm.field !== "repo" ? null : <FolderPickerCard vm={vm} />}
      {/* More repos the task spans: the repo above is the primary, these follow in pick order. Not for
          "open the project", which enters one existing checkout. */}
      {vm.extraCandidates.length > 0 &&
      !(vm.intent === "project" && vm.canOpenProject) &&
      (!only || vm.field === "extras") ? (
        <>
          <DialogSection
            label={t("newTask.field.extras")}
            focused={vm.field === "extras"}
            onPress={() => vm.setField("extras")}
          >
            <box paddingLeft={2}>
              <text fg={vm.extraPicked.length > 0 ? theme.accent : theme.textMuted} wrapMode="none">
                {vm.extraPicked.length > 0
                  ? vm.extraPicked.map((repo) => splitRepoRow(repo).base).join(", ")
                  : t("newTask.hint.extrasNone")}
              </text>
            </box>
          </DialogSection>
          {vm.field === "extras" ? (
            <PickerList
              window={vm.extraWindow}
              cursor={vm.extraCursor}
              rows={vm.extraWindow.items.map((repo, i) => {
                const { base, dir } = splitRepoRow(repo)
                const order = vm.extraPicked.indexOf(repo)
                return {
                  key: `${vm.extraWindow.start + i}:${repo}`,
                  body: `${order >= 0 ? "[x] " : "[ ] "}${base}`,
                  dim: dir,
                  accent: order >= 0,
                }
              })}
              onPick={vm.pickExtraAt}
              paddingBottom={1}
            />
          ) : null}
        </>
      ) : null}
      {/* Only for a repo that HAS a project checkout. Everywhere
          else this row would be a control whose second option does nothing,
          so it stays absent rather than disabled. */}
      {vm.canOpenProject && (!only || vm.field === "intent") ? (
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
      {(vm.intent === "project" && vm.canOpenProject) || vm.noFolder || (only && vm.field !== "baseRef") ? null : (
        <DialogSection
          label={t("newTask.field.fromBranch")}
          focused={vm.field === "baseRef"}
          onPress={() => vm.setField("baseRef")}
        >
          <DialogField focused={vm.field === "baseRef"}>
            <input
              {...INPUT_SCROLL}
              value={vm.baseRef}
              placeholder={DEFAULT_BASE_REF}
              focused={vm.field === "baseRef"}
              onMouseUp={() => vm.setField("baseRef")}
              onInput={(v: string) => vm.setBaseRefText(v)}
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

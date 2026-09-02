/** @jsxImportSource @opentui/react */
/**
 * Clone ("For New Repo") tab of the new-task dialog — git URL, parent dir (with the same drill-down picker the
 * existing tab uses), auto-derived folder name, base branch. The async
 * clone runs in the view-model; this file is JSX only.
 */

import { DEFAULT_BASE_REF } from "../../../tui/lib/git-snapshot"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { DialogField, DialogSection } from "../../ui/dialog-parts"
import { PickerList } from "./picker-list"
import type { NewTaskVm } from "./view-model"

export function CloneTab({ vm }: { vm: NewTaskVm }) {
  const { theme } = useTheme()
  const t = useT()

  const parentRows = vm.cloneParentWindow.items.map((name, i) => ({
    key: `${vm.cloneParentWindow.start + i}:${name}`,
    body: `${name}/`,
  }))

  return (
    <>
      <DialogSection
        label={t("newTask.field.gitUrl")}
        focused={vm.field === "cloneUrl"}
        onPress={() => vm.setField("cloneUrl")}
      >
        <DialogField focused={vm.field === "cloneUrl"}>
          <input
            value={vm.cloneUrl}
            placeholder="https://github.com/user/repo.git"
            focused={vm.field === "cloneUrl"}
            onMouseUp={() => vm.setField("cloneUrl")}
            onInput={(v: string) => vm.setCloneUrlText(v)}
            onSubmit={() => {
              if (!vm.cloneUrl.trim()) return
              vm.setField("cloneParent")
            }}
          />
        </DialogField>
      </DialogSection>
      <DialogSection
        label={t("newTask.field.parentDir")}
        focused={vm.field === "cloneParent"}
        onPress={() => vm.setField("cloneParent")}
      >
        <DialogField focused={vm.field === "cloneParent"}>
          <input
            value={vm.cloneParent}
            placeholder="~/"
            focused={vm.field === "cloneParent"}
            onMouseUp={() => vm.setField("cloneParent")}
            onInput={(v: string) => vm.setCloneParentText(v)}
            onSubmit={() => vm.onCloneParentSubmit()}
          />
        </DialogField>
      </DialogSection>
      {/* Persistence hint — this field remembers its last value across
          dialog opens (kv `lastClonedRepoParent`). */}
      {vm.field === "cloneParent" ? (
        <box paddingLeft={2}>
          <text fg={theme.textMuted} wrapMode="none">
            {t("newTask.hint.remembered")}
          </text>
        </box>
      ) : null}
      {vm.field === "cloneParent" && vm.cloneParentFiltered.length > 0 && !vm.cloneParentPicked ? (
        <PickerList
          window={vm.cloneParentWindow}
          cursor={vm.cloneParentCursor}
          rows={parentRows}
          onPick={vm.selectCloneParentAt}
        />
      ) : null}
      <DialogSection
        label={t("newTask.field.folderName")}
        focused={vm.field === "cloneFolder"}
        onPress={() => vm.setField("cloneFolder")}
      >
        <DialogField focused={vm.field === "cloneFolder"}>
          <input
            value={vm.cloneFolder}
            placeholder={t("newTask.placeholder.folderName")}
            focused={vm.field === "cloneFolder"}
            onMouseUp={() => vm.setField("cloneFolder")}
            onInput={(v: string) => vm.setCloneFolderText(v)}
            onSubmit={() => vm.setField("cloneBaseRef")}
          />
        </DialogField>
      </DialogSection>
      <DialogSection
        label={t("newTask.field.baseBranch")}
        focused={vm.field === "cloneBaseRef"}
        onPress={() => vm.setField("cloneBaseRef")}
      >
        <DialogField focused={vm.field === "cloneBaseRef"}>
          <input
            value={vm.cloneBaseRef}
            placeholder={DEFAULT_BASE_REF}
            focused={vm.field === "cloneBaseRef"}
            onMouseUp={() => vm.setField("cloneBaseRef")}
            onInput={(v: string) => vm.setCloneBaseRefText(v)}
            // Last field on the tab — Enter kicks off the clone + create.
            onSubmit={() => void vm.commitClone()}
          />
        </DialogField>
      </DialogSection>
      {vm.cloneInFlight ? (
        <box gap={0} paddingLeft={2}>
          <text fg={theme.textMuted} wrapMode="none">
            {vm.cloneProgress || t("newTask.clone.progressFallback")}
          </text>
        </box>
      ) : null}
    </>
  )
}

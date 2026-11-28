/** @jsxImportSource @opentui/react */
/**
 * Folder picker section for the New task composer, rendered in the native
 * dialog grammar (`DialogSection` + full-width `DialogField` + `PickerList`):
 *   - Saved mode: `Search folders...` -> `No folder`, clean saved folder names
 *     (parent dir muted only when two share a basename), and pinned `+ Open folder…`.
 *   - Folder-browse mode (`+ Open folder…`): directory path in the section hint,
 *     filter input, `..` & subfolders (with `git` tag), and pinned `Use "<dir>"` / `← Back`.
 *   - Path-browse mode (typing `/`, `~/`, `C:\`): verbatim path + matching subfolders.
 */

import { pathLeaf, stripTrailingSlash } from "@sma1lboy/rove-core/lib/path-helpers.ts"
import { tildify } from "@sma1lboy/rove-core/lib/path-home.ts"
import { samePath } from "@sma1lboy/rove-daemon/path-identity"
import { splitRepoRow } from "../../../tui/component/new-task-dialog/state"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { DialogField, DialogSection } from "../../ui/dialog-parts"
import { INPUT_SCROLL } from "../../ui/input-scroll"
import { PickerList, type PickerRow, type PinnedPickerRow } from "./picker-list"
import { BROWSE_UP_ROW } from "./use-repo-field"
import type { NewTaskVm } from "./view-model"

export function FolderPickerCard({ vm }: { vm: NewTaskVm }) {
  const { theme } = useTheme()
  const t = useT()
  const focused = vm.field === "repo"

  if (vm.mode === "folder-browse") {
    const dirLabel = tildify(vm.browseDirBase)
    const leaf =
      dirLabel === "~" || dirLabel === "~/" ? "~" : pathLeaf(stripTrailingSlash(vm.browseDirBase)) || dirLabel
    const selectHereIdx = vm.browseMiddleLength
    const backIdx = vm.browseMiddleLength + 1

    const rows: PickerRow[] = vm.browseWindow.items.map((item, i) => {
      const absIdx = vm.browseWindow.start + i
      const isUp = item === BROWSE_UP_ROW
      const isGit = !isUp && vm.gitDirs.has(item)
      return {
        key: `${absIdx}:${item}`,
        body: isUp ? ".." : `${item}/`,
        accent: isGit,
        ...(isUp ? { dim: t("newTask.picker.parentFolder") } : isGit ? { dim: t("newTask.picker.gitBadge") } : {}),
      }
    })

    const pinnedBottom: PinnedPickerRow[] = [
      { key: "browse:use", index: selectHereIdx, body: t("newTask.picker.useFolder", { name: leaf }) },
      { key: "browse:back", index: backIdx, body: t("newTask.picker.backToFolders") },
    ]

    return (
      <>
        <DialogSection
          label={t("newTask.field.openFolder")}
          hint={dirLabel}
          focused={focused}
          onPress={() => vm.setField("repo")}
        >
          <DialogField focused={focused}>
            <input
              {...INPUT_SCROLL}
              value={vm.searchQuery}
              placeholder={t("newTask.placeholder.filterFolders")}
              focused={focused}
              onMouseUp={() => vm.setField("repo")}
              onInput={(v: string) => vm.setSearchText(v)}
              onSubmit={() => vm.onRepoSubmit()}
            />
          </DialogField>
        </DialogSection>
        {focused && !vm.repoPicked ? (
          <PickerList
            window={vm.browseWindow}
            cursor={vm.repoCursor}
            rows={rows}
            pinnedBottom={pinnedBottom}
            onPick={vm.selectRepoAt}
            footer={
              <>
                {rows.length === 0 ? (
                  <text fg={theme.textMuted} wrapMode="none">
                    {`  ${t("newTask.picker.noFolders")}`}
                  </text>
                ) : null}
                <text fg={theme.textMuted} wrapMode="word">
                  {`  ${t("newTask.picker.browseHint")}`}
                </text>
              </>
            }
          />
        ) : null}
      </>
    )
  }

  if (vm.mode === "path-browse") {
    const rows: PickerRow[] = vm.pathBrowseWindow.items.map((name, i) => {
      const absIdx = vm.pathBrowseWindow.start + i
      const isGit = vm.gitDirs.has(name)
      return {
        key: `${absIdx}:${name}`,
        body: `${name}/`,
        accent: isGit,
        ...(isGit ? { dim: t("newTask.picker.gitBadge") } : {}),
      }
    })
    return (
      <>
        <DialogSection label={t("newTask.field.repo")} focused={focused} onPress={() => vm.setField("repo")}>
          <DialogField focused={focused}>
            <input
              {...INPUT_SCROLL}
              value={vm.searchQuery}
              placeholder={t("newTask.placeholder.searchFolders")}
              focused={focused}
              onMouseUp={() => vm.setField("repo")}
              onInput={(v: string) => vm.setSearchText(v)}
              onSubmit={() => vm.onRepoSubmit()}
            />
          </DialogField>
        </DialogSection>
        {focused && !vm.repoPicked && rows.length > 0 ? (
          <PickerList window={vm.pathBrowseWindow} cursor={vm.repoCursor} rows={rows} onPick={vm.selectRepoAt} />
        ) : null}
      </>
    )
  }

  // Saved mode: native DialogSection + DialogField + PickerList
  const openFolderIdx = vm.activeList.length - 1
  const pinnedTop: PinnedPickerRow[] = vm.showNoFolder
    ? [
        {
          key: "saved:no-folder",
          index: 0,
          body: t("newTask.noFolder"),
          accent: vm.noFolder,
          ...(vm.noFolder ? { dim: "✓" } : {}),
        },
      ]
    : []

  const recentRows: PickerRow[] = vm.recentWindow.items.map((path, i) => {
    const absIdx = vm.recentOffset + vm.recentWindow.start + i
    const { base, dir } = splitRepoRow(path)
    const checked = !vm.noFolder && samePath(vm.expandedRepo, path)
    const disambiguate = vm.duplicateNames.has(base.toLowerCase()) ? tildify(dir) : ""
    const tail = disambiguate && checked ? `${disambiguate}  ✓` : disambiguate || (checked ? "✓" : "")
    return {
      key: `${absIdx}:${path}`,
      body: base,
      accent: checked,
      ...(tail ? { dim: tail } : {}),
    }
  })

  const pinnedBottom: PinnedPickerRow[] = [
    { key: "saved:open-folder", index: openFolderIdx, body: t("newTask.picker.openFolder") },
  ]

  return (
    <>
      <DialogSection label={t("newTask.field.repo")} focused={focused} onPress={() => vm.setField("repo")}>
        <DialogField focused={focused}>
          <input
            {...INPUT_SCROLL}
            value={vm.searchQuery}
            placeholder={t("newTask.placeholder.searchFolders")}
            focused={focused}
            onMouseUp={() => vm.setField("repo")}
            onInput={(v: string) => vm.setSearchText(v)}
            onSubmit={() => vm.onRepoSubmit()}
          />
        </DialogField>
      </DialogSection>
      {focused && !vm.repoPicked ? (
        <PickerList
          window={vm.recentWindow}
          indexOffset={vm.recentOffset}
          cursor={vm.repoCursor}
          pinnedTop={pinnedTop}
          rows={recentRows}
          pinnedBottom={pinnedBottom}
          onPick={vm.selectRepoAt}
        />
      ) : null}
    </>
  )
}

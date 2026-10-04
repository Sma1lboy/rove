/** @jsxImportSource @opentui/react */
/**
 * New-task dialog entry point: every call site goes through
 * `show(dialog, defaultRepo, savedRepos, options)`. THE canonical
 * task-creation surface — never a simplified stand-in.
 */

import type { NewTaskDialogOptions, NewTaskInput } from "../../../tui/component/new-task-dialog/state"
import { type DialogContext, showDialog } from "../../ui/dialog"
import { NewTaskDialogView } from "./dialog"

export type { NewTaskDialogOptions } from "../../../tui/component/new-task-dialog/state"

/**
 * Open the new-task dialog and resolve with the user's selection —
 * `undefined` on cancel (esc / dialog dismissed). A `cloned` field on the
 * result means the user came in via the "For New Repo" tab: the clone has
 * already completed and `repo` is the fresh worktree path; persist
 * `cloned.parentDir` to `lastClonedRepoParent` and add `repo` to the
 * saved-repos list.
 */
function show(
  dialog: DialogContext,
  defaultRepo: string,
  savedRepos: readonly string[],
  options?: NewTaskDialogOptions,
): Promise<NewTaskInput | undefined> {
  // medium (80 cols): small clipped repo paths mid-row.
  return showDialog<NewTaskInput>(
    dialog,
    (resolve) => (
      <NewTaskDialogView
        defaultRepo={defaultRepo}
        savedRepos={savedRepos}
        defaultCloneParent={options?.defaultCloneParent}
        defaultVendor={options?.defaultVendor}
        availableVendors={options?.availableVendors}
        discoverAdoptable={options?.discoverAdoptable}
        mainRepos={options?.mainRepos}
        onSubmit={(v) => resolve(v)}
        onCancel={() => resolve(undefined)}
      />
    ),
    { size: "medium" },
  )
}

export const NewTaskDialog = {
  show,
}

/** @jsxImportSource @opentui/react */
/**
 * New task, as a page in the content pane: the task list stays beside it and
 * the form takes the pane's keys only while the pane has focus. THE canonical
 * task-creation surface — never a simplified stand-in.
 */

import type { NewTaskDialogOptions, NewTaskInput } from "../../../tui/component/new-task-dialog/state"
import { NewTaskDialogView } from "./dialog"

export type { NewTaskDialogOptions } from "../../../tui/component/new-task-dialog/state"

/** Columns the form keeps in a wide pane, so its fields don't stretch into unreadable rules. */
const FORM_WIDTH = 100

export interface NewTaskPageProps {
  readonly defaultRepo: string
  readonly savedRepos: readonly string[]
  readonly options?: NewTaskDialogOptions
  readonly focused: boolean
  /**
   * The user's selection, or `undefined` on cancel. A `cloned` field means the
   * "For New Repo" tab already cloned: `repo` is the fresh checkout; persist
   * `cloned.parentDir` to `lastClonedRepoParent` and save `repo`.
   */
  readonly onDone: (value: NewTaskInput | undefined) => void
}

export function NewTaskPage(props: NewTaskPageProps) {
  const { options } = props
  return (
    <box flexGrow={1} paddingTop={1} overflow="hidden">
      <box width={FORM_WIDTH} maxWidth="100%" flexShrink={1} overflow="hidden">
        <NewTaskDialogView
          defaultRepo={props.defaultRepo}
          savedRepos={props.savedRepos}
          defaultCloneParent={options?.defaultCloneParent}
          defaultVendor={options?.defaultVendor}
          availableVendors={options?.availableVendors}
          discoverAdoptable={options?.discoverAdoptable}
          mainRepos={options?.mainRepos}
          initialBaseRef={options?.initialBaseRef}
          focused={props.focused}
          onSubmit={(value) => props.onDone(value)}
          onCancel={() => props.onDone(undefined)}
        />
      </box>
    </box>
  )
}

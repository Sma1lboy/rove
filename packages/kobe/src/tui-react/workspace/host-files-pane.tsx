/** @jsxImportSource @opentui/react */
/**
 * The workspace host's right rail — the FileTree pane and its width math.
 *
 * A region that owns its own layout, like `host-sidebar.tsx`: the width math
 * below is this rail's business, not the host's. Width: a third of what's left
 * beside the sidebar, clamped to the documented worktree-tools convention
 * [22, 34].
 */

import { useTerminalDimensions } from "@opentui/react"
import { sidebarWidthFor } from "../../tui/panes/sidebar/view-core"
import { useFocus } from "../context/focus"
import { useTheme } from "../context/theme"
import { FileTree } from "../panes/filetree/FileTree"

const WORKTREE_TOOLS_MIN_WIDTH = 22
const WORKTREE_TOOLS_MAX_WIDTH = 34

export function HostFilesPane(props: {
  readonly worktree: string | null
  readonly prBaseRef: string | undefined
  /** Dialog-gated pane focus (`activePane`), not the raw focus context. */
  readonly focused: boolean
  readonly onOpenFile: (relPath: string) => void
  readonly onOpenDiff: (relPath: string, base?: string) => void
  /** `a` — paste an `@<path>` mention into the engine's composer (no submit). */
  readonly onMention: (relPath: string) => void
  readonly onZenToggle: () => void
  readonly onCreatePR: () => void
  /** Selected task's `kind`. A `"main"` row IS the repo's root checkout —
   *  `branch: ""`, `worktreePath === repo` — so it has no task branch to open
   *  a PR from and `createPRAction` can only answer with its
   *  already-on-the-target-branch toast. The header withholds the chip there.
   *  `"dir"` rows point at a directory whose branch Rove does not own, so they
   *  keep it. */
  readonly taskKind: "main" | "task" | "dir" | undefined
}) {
  const { theme } = useTheme()
  const focus = useFocus()
  const dims = useTerminalDimensions()
  const inactiveBorder = theme.borderActive
  const available = Math.max(WORKTREE_TOOLS_MIN_WIDTH, dims.width - sidebarWidthFor(dims.width))
  const width = Math.max(WORKTREE_TOOLS_MIN_WIDTH, Math.min(WORKTREE_TOOLS_MAX_WIDTH, Math.floor(available / 3)))
  return (
    <box
      width={width}
      flexShrink={0}
      borderStyle="rounded"
      borderColor={focus.focused === "files" ? theme.focusAccent : inactiveBorder}
      onMouseUp={() => focus.setFocused("files")}
    >
      <FileTree
        worktreePath={props.worktree}
        paneWidth={width - 2 /* box border */}
        prBaseRef={props.prBaseRef}
        focused={props.focused}
        onOpenFile={props.onOpenFile}
        onOpenDiff={props.onOpenDiff}
        onMention={props.onMention}
        onZenToggle={props.onZenToggle}
        // Withholding the chip is not withholding the action: `files.createPR`
        // is a GLOBAL prefix binding, so prefix+P still fires on a main row and
        // still explains itself with the toast.
        onCreatePR={props.taskKind === "main" ? undefined : props.onCreatePR}
      />
    </box>
  )
}

/** @jsxImportSource @opentui/react */
/** The host's right rail (FileTree). Width: a third of what's left beside the
 *  sidebar, clamped to the worktree-tools convention [22, 34]. */

import { useTerminalDimensions } from "@opentui/react"
import { useFocus } from "../context/focus"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { FileTree } from "../panes/filetree/FileTree"

const WORKTREE_TOOLS_MIN_WIDTH = 22
const WORKTREE_TOOLS_MAX_WIDTH = 34

export function HostFilesPane(props: {
  /** The sidebar's width RIGHT NOW, handed down: it depends on a KV-stored
   *  drag pin, and re-deriving it here would tear the layout mid-drag. */
  readonly sidebarWidth: number
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
  /** A `"main"` row IS the root checkout (no task branch to PR from), so the
   *  header withholds the Create PR chip; `"dir"` rows keep it. */
  readonly taskKind: "main" | "task" | "dir" | undefined
  /** Remote host of the worktree: the path means nothing locally, so the pane names the machine instead. */
  readonly remoteHost?: string
}) {
  const { theme } = useTheme()
  const t = useT()
  const focus = useFocus()
  const dims = useTerminalDimensions()
  const inactiveBorder = theme.borderActive
  const available = Math.max(WORKTREE_TOOLS_MIN_WIDTH, dims.width - props.sidebarWidth)
  const width = Math.max(WORKTREE_TOOLS_MIN_WIDTH, Math.min(WORKTREE_TOOLS_MAX_WIDTH, Math.floor(available / 3)))
  return (
    <box
      width={width}
      flexShrink={0}
      borderStyle="rounded"
      borderColor={focus.focused === "files" ? theme.focusAccent : inactiveBorder}
      onMouseUp={() => focus.setFocused("files")}
    >
      {props.remoteHost ? (
        <box flexDirection="column" padding={1} gap={1}>
          <text fg={theme.textMuted} wrapMode="word">
            {t("tasks.machine.filesElsewhere", { host: props.remoteHost })}
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            {t("tasks.machine.filesHint", { host: props.remoteHost })}
          </text>
        </box>
      ) : (
        <FileTree
          worktreePath={props.worktree}
          paneWidth={width - 2 /* box border */}
          prBaseRef={props.prBaseRef}
          focused={props.focused}
          onOpenFile={props.onOpenFile}
          onOpenDiff={props.onOpenDiff}
          onMention={props.onMention}
          onZenToggle={props.onZenToggle}
          // prefix+P is GLOBAL, so it still fires here and explains itself with a toast.
          onCreatePR={props.taskKind === "main" ? undefined : props.onCreatePR}
        />
      )}
    </box>
  )
}

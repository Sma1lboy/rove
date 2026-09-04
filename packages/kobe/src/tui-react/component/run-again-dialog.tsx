/** @jsxImportSource @opentui/react */
/**
 * Run-again confirm — the row menu's "Run again" entry.
 *
 * Rove records a task's brief verbatim on delivery (`task.prompt`), and until
 * this dialog the only reader was `rove api get-task | jq -r .task.prompt`
 * piped back into `rove api add`. The entry re-fires that text into a FRESH
 * task, so the dialog's whole job is to show what will be re-run before it is.
 *
 * The brief is scrollable rather than truncated, for the same reason the field
 * is stored untruncated: the constraints that decide whether a re-run is the
 * right move usually sit at the END of a long brief. A one-line `DialogConfirm`
 * message would clip exactly the part worth reading.
 *
 * Not destructive: confirming creates a task and touches nothing that exists,
 * so initial focus is on the confirm button (the `danger` convention is for
 * the ones that remove something).
 */

import { TextAttributes } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useRef, useState } from "react"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"

export function RunAgainDialogView(props: {
  /** The source task's title — names whose brief is on screen. */
  taskTitle: string
  /** The brief, verbatim. Newlines and blank lines are preserved. */
  prompt: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { theme } = useTheme()
  const t = useT()
  const dialog = useDialog()
  const padX = useDialogPaddingX()
  const [active, setActive] = useState<"confirm" | "cancel">("confirm")

  // Resolving the promise does not pop the stack — the view closes itself, the
  // same contract the status/engine pickers follow. `refocus: false` on the
  // commit path: confirming ENTERS the new task, and the provider's deferred
  // restore would otherwise yank focus back to the sidebar a tick later.
  const commit = (): void => {
    props.onConfirm()
    dialog.clear({ refocus: false })
  }
  const cancel = (): void => {
    props.onCancel()
    dialog.clear()
  }

  // Up/down scroll the brief (same shape as the field-notes reader); left/right
  // move between the two buttons, so neither gesture shadows the other.
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const scrollBy = (lines: number): void => {
    const scroll = scrollRef.current
    if (!scroll) return
    scroll.scrollTo({ x: 0, y: Math.max(0, scroll.scrollTop + lines) })
  }
  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => scrollBy(-1) },
      { key: "down", cmd: () => scrollBy(1) },
      { key: "pageup", cmd: () => scrollBy(-(scrollRef.current?.viewport.height ?? 10)) },
      { key: "pagedown", cmd: () => scrollBy(scrollRef.current?.viewport.height ?? 10) },
      { key: "left", cmd: () => setActive((a) => (a === "confirm" ? "cancel" : "confirm")) },
      { key: "right", cmd: () => setActive((a) => (a === "confirm" ? "cancel" : "confirm")) },
      { key: "return", cmd: () => (active === "confirm" ? commit() : cancel()) },
    ],
  }))

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={1} flexShrink={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="column" gap={0}>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            {t("tasks.runAgain.title")}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            {t("tasks.runAgain.source", { title: props.taskTitle })}
          </text>
        </box>
        <text fg={theme.textMuted} onMouseUp={cancel}>
          esc
        </text>
      </box>
      <scrollbox
        ref={(r: ScrollBoxRenderable | null) => {
          scrollRef.current = r
        }}
        flexShrink={1}
        stickyScroll={false}
        verticalScrollbarOptions={{
          trackOptions: { backgroundColor: theme.backgroundDialog, foregroundColor: theme.borderActive },
        }}
      >
        <box paddingRight={1}>
          <text fg={theme.text}>{props.prompt}</text>
        </box>
      </scrollbox>
      <text fg={theme.textMuted} flexShrink={0}>
        {t("tasks.runAgain.hint")}
      </text>
      <box flexDirection="row" justifyContent="flex-end" flexShrink={0}>
        {(["cancel", "confirm"] as const).map((key) => (
          <box
            key={key}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={key === active ? theme.primary : undefined}
            onMouseUp={() => (key === "confirm" ? commit() : cancel())}
          >
            <text fg={key === active ? theme.selectedListItemText : theme.textMuted}>
              {key === "cancel" ? t("common.cancel") : t("tasks.runAgain.confirm")}
            </text>
          </box>
        ))}
      </box>
      <box paddingBottom={1} flexShrink={0}>
        <text fg={theme.textMuted}>{t("tasks.runAgain.footer")}</text>
      </box>
    </box>
  )
}

/** Open the confirm; resolves `true` only when the user commits the re-run
 *  (esc / backdrop dismissal resolves `undefined` through `showDialog`). */
function show(dialog: DialogContext, opts: { taskTitle: string; prompt: string }): Promise<boolean | undefined> {
  return showDialog<boolean>(
    dialog,
    (resolve) => (
      <RunAgainDialogView
        taskTitle={opts.taskTitle}
        prompt={opts.prompt}
        onConfirm={() => resolve(true)}
        onCancel={() => resolve(false)}
      />
    ),
    { size: "medium" },
  )
}

export const RunAgainDialog = { show }

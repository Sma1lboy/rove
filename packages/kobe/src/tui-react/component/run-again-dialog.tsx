/** @jsxImportSource @opentui/react */
/**
 * Run-again confirm: shows a task's verbatim brief (`task.prompt`) before
 * re-firing it into a FRESH task.
 *
 * Scrollable, not truncated: the constraints that decide a re-run usually sit
 * at the END of a long brief, which a one-line `DialogConfirm` would clip.
 * Not destructive (creates a task, touches nothing existing), so initial focus
 * is on confirm.
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

  // Resolving does not pop the stack; the view closes itself. `refocus: false`
  // on commit: confirming ENTERS the new task, and the provider's deferred
  // restore would yank focus back to the sidebar a tick later.
  const commit = (): void => {
    props.onConfirm()
    dialog.clear({ refocus: false })
  }
  const cancel = (): void => {
    props.onCancel()
    dialog.clear()
  }

  // Up/down scroll the brief; left/right move between buttons, so neither shadows the other.
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
      { key: "h", cmd: () => setActive((a) => (a === "confirm" ? "cancel" : "confirm")) },
      { key: "l", cmd: () => setActive((a) => (a === "confirm" ? "cancel" : "confirm")) },
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

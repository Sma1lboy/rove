/** A file opened from the Files tree shows its content; when the working tree changed it, `[ file ] [ diff ]` flips to the diff. */

import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { parseUnifiedDiff } from "./diff.ts"
import { t } from "./i18n/index.ts"
import { openDiff } from "./panel-state.ts"
import { requestRemembered } from "./remembered.ts"
import { Button } from "./ui/button.tsx"

/** `file`: the file's content is showing, not its diff. Choosing the other reopens this tab that way. */
export function FileModeBar(props: { taskId: string; path: string; file: boolean }) {
  const choice = (file: boolean, label: string) => (
    <Button
      hit="tight"
      aria-pressed={props.file === file}
      className="opacity-60 aria-pressed:underline aria-pressed:opacity-100"
      onClick={() => openDiff({ taskId: props.taskId, path: props.path, scope: "working", ...(file ? { file } : {}) })}
    >
      {label}
    </Button>
  )
  return (
    <div className="flex flex-none items-center gap-3 px-2 pt-1.5 font-mono text-meta">
      {choice(true, t("preview.modeFile"))}
      {choice(false, t("preview.modeDiff"))}
    </div>
  )
}

/** The new-side line numbers the working tree added or changed in `path`; null until read, or when `on` is false. */
export function useChangedLines(
  client: BridgeClient,
  taskId: string,
  path: string,
  on: boolean,
  reload: number,
): ReadonlySet<number> | null {
  const [lines, setLines] = useState<ReadonlySet<number> | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is the refresh trigger.
  useEffect(() => {
    if (!on) return
    let live = true
    requestRemembered<{ kind?: string; text?: string }>(client, "diff.file", { taskId, path, scope: "working" }).then(
      (data) => {
        if (!live) return
        const rows = data.kind === "diff" && typeof data.text === "string" ? parseUnifiedDiff(data.text, path) : []
        setLines(new Set(rows.flatMap((row) => (row.kind === "add" && row.newNo !== null ? [row.newNo] : []))))
      },
      () => live && setLines(null),
    )
    return () => {
      live = false
    }
  }, [client, taskId, path, on, reload])
  return on ? lines : null
}

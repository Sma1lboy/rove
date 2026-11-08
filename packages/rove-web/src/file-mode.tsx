/** The File and Diff columns of one changed file point at each other: `[ diff ]` from the file, `[ file ]` from its diff. */

import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { parseUnifiedDiff } from "./diff.ts"
import { t } from "./i18n/index.ts"
import { openDiff, openFile } from "./panel-state.ts"
import { requestRemembered } from "./remembered.ts"
import { Button } from "./ui/button.tsx"

/** `file`: this is the File column, so the link opens the diff beside it; otherwise the file. */
export function OtherViewLink(props: { taskId: string; path: string; file: boolean }) {
  const open = () =>
    props.file
      ? openDiff({ taskId: props.taskId, path: props.path, scope: "working" })
      : openFile(props.taskId, props.path)
  return (
    <div className="flex flex-none items-center gap-3 px-2 pt-1.5 font-mono text-meta">
      <Button hit="tight" onClick={open}>
        {t(props.file ? "preview.modeDiff" : "preview.modeFile")}
      </Button>
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

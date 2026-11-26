/**
 * One attempt's change, read-only, in its Compare column: the side panel's `diff.file` read and row look, without
 * its cursor, notes or folds. A file's name opens that file in the task's own diff.
 */

import { useEffect, useMemo, useState } from "react"
import { type DiffRow, fileStats } from "./diff.ts"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { type Loaded, load } from "./preview-load.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { Button } from "./ui/button.tsx"
import { Chip } from "./ui/chip.tsx"
import { CMP_DIFF, CMP_DIFF_FILE, CMP_DIFF_NAME } from "./ui/compare.ts"
import { DIFF_FILE_NAME, DIFF_GUTTER, OLD_GUTTER, diffCodeClass, diffRowClass, diffSignClass } from "./ui/diff-row.ts"
import { PLACEHOLDER_LINE } from "./ui/text.ts"

// ponytail: a cap, not virtualisation; the task's own diff has the rest.
const MAX_ROWS = 400

export function CompareDiff(props: {
  model: AppModel
  taskId: string
  scope: "working" | "branch"
  /** Changes whenever the attempt's files or status do: the reread trigger. */
  refresh: string
  onOpen: (path: string) => void
}) {
  const { model, taskId, scope } = props
  const params = { taskId, path: ".", scope }
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    const last = lastReply<unknown>(model, "diff.file", params)
    return last === undefined ? null : load(last, ".", false)
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is the reread trigger
  useEffect(() => {
    let live = true
    requestRemembered<unknown>(model, "diff.file", { taskId, path: ".", scope }).then(
      (data) => live && setLoaded(load(data, ".", false)),
      (err) => live && setLoaded({ kind: "text", text: err instanceof Error ? err.message : String(err), error: true }),
    )
    return () => {
      live = false
    }
  }, [model, taskId, scope, props.refresh])

  // index / --- / +++ lines say nothing the file row does not.
  const rows = useMemo(
    () => (loaded?.kind === "rows" ? loaded.rows.filter((row) => row.kind !== "meta") : []),
    [loaded],
  )
  const stats = useMemo(() => fileStats(rows), [rows])
  const more = rows.length - MAX_ROWS

  return (
    <div className={CMP_DIFF}>
      {!loaded && <p className={PLACEHOLDER_LINE}>{t("preview.loading")}</p>}
      {loaded?.kind === "text" && (
        <p className={`${PLACEHOLDER_LINE} ${loaded.error ? "text-error" : ""}`}>{loaded.text}</p>
      )}
      {rows.slice(0, MAX_ROWS).map((row, i) =>
        row.kind === "file" ? (
          <FileRow
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are rebuilt whole on every read
            key={i}
            row={row}
            stat={stats.get(i)}
            onOpen={props.onOpen}
          />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are rebuilt whole on every read
          <div key={i} className={diffRowClass(row.kind, { cursor: false, noted: false })}>
            <span className={OLD_GUTTER}>{row.oldNo ?? ""}</span>
            <span className={DIFF_GUTTER}>{row.newNo ?? ""}</span>
            <span className={diffSignClass(row.kind, false)}>
              {row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
            </span>
            <span className={diffCodeClass(row.kind)}>{row.text}</span>
          </div>
        ),
      )}
      {more > 0 && (
        <Button hit="tight" className="mx-3 my-2 font-mono text-meta" onClick={() => props.onOpen(".")}>
          {t("compare.moreLines", { count: more })}
        </Button>
      )}
    </div>
  )
}

function FileRow(props: {
  row: DiffRow
  stat: { added: number; removed: number } | undefined
  onOpen: (path: string) => void
}) {
  const { row, stat } = props
  return (
    <Button
      variant="row"
      title={row.text}
      className={`${diffRowClass("file", { cursor: false, noted: false })} ${CMP_DIFF_FILE}`}
      onClick={() => props.onOpen(row.path ?? ".")}
    >
      {/* No line numbers on a file row: the first cell stays blank and the name takes the rest. */}
      <span />
      <span className={DIFF_FILE_NAME}>
        <span className={CMP_DIFF_NAME}>{row.text}</span>
        {stat?.added ? <Chip tone="added">+{stat.added}</Chip> : null}
        {stat?.removed ? <Chip tone="removed">−{stat.removed}</Chip> : null}
      </span>
    </Button>
  )
}

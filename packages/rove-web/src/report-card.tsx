/** The top of the Files pane: what the task says it did, plus branch, size, checks and open todos, copyable as a note or a PR body. */

import { useEffect, useMemo, useState } from "react"
import type { DiffFileRow, TaskRow } from "rove-bridge/protocol"
import { type CheckState, type ChecksReply, checkCounts } from "./checks-data.ts"
import { type OutputReply, replyExcerpt } from "./compare-data.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { type ReportFacts, asNote, asPrBody, checksLine } from "./report-card-data.ts"
import { openTodos } from "./task-todos.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { Chevron } from "./ui/chevron.tsx"

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast(t("files.report.copied"))
  } catch {
    toast(t("menu.copyFailed"), "error")
  }
}

export function ReportCard(props: {
  model: AppModel
  task: TaskRow
  base: string | null
  files: readonly DiffFileRow[]
  narrow: boolean
}) {
  useLocale()
  const { model, task } = props
  const [open, setOpen] = useState(!props.narrow)
  // A task with no report shows its last reply instead (and only then reads it).
  const [reply, setReply] = useState<string | null>(null)
  const reported = !!task.report?.summary
  // biome-ignore lint/correctness/useExhaustiveDependencies: reread when the task's status moves
  useEffect(() => {
    if (reported) return
    let live = true
    requestRemembered<OutputReply>(model, "output.read", { taskId: task.id, limit: 8 }).then(
      (r) => live && setReply(replyExcerpt(r)),
      () => {},
    )
    return () => {
      live = false
    }
  }, [model, task.id, reported, task.rowStatus?.since])

  const facts = useMemo((): ReportFacts => {
    const checks = lastReply<ChecksReply>(model, "pr.checks", { taskId: task.id })
    const counts = checks?.outcome === "ok" ? checkCounts(checks.checks) : null
    return {
      title: task.label || task.title,
      branch: task.branch,
      base: props.base,
      files: new Set(props.files.map((f) => f.path)).size,
      added: props.files.reduce((n, f) => n + (f.added ?? 0), 0),
      removed: props.files.reduce((n, f) => n + (f.deleted ?? 0), 0),
      text: task.report?.summary ?? reply,
      reported,
      checks: counts
        ? checksLine(counts as Record<CheckState, number>)
        : task.pr?.checkState && task.pr.checkState !== "unknown"
          ? task.pr.checkState
          : null,
      openTodos: openTodos(task).map((todo) => todo.text),
      pr: task.pr ? { number: task.pr.number, url: task.pr.url } : null,
    }
  }, [model, task, props.base, props.files, reply, reported])

  return (
    <section className="flex flex-col gap-1 px-2 pb-2 font-mono text-meta">
      <Button
        variant="row"
        aria-expanded={open}
        className="flex items-center gap-1.5 text-left text-muted hover:text-ink"
        onClick={() => setOpen(!open)}
      >
        <Chevron right={!open} />
        <span className="min-w-0 flex-1 truncate">
          {t("files.report.title")} · {facts.files} · +{facts.added} −{facts.removed}
        </span>
      </Button>
      {open && (
        <>
          <p className="m-0 text-muted">
            {facts.branch}
            {facts.base ? ` → ${facts.base}` : ""}
            {facts.checks ? ` · ${facts.checks}` : ""}
            {facts.openTodos.length > 0 ? ` · ${t("files.report.todos", { count: facts.openTodos.length })}` : ""}
          </p>
          {facts.text ? (
            <>
              <span className="text-subtle">{reported ? t("files.report.claimed") : t("files.report.lastReply")}</span>
              <p className="m-0 max-h-24 overflow-y-auto whitespace-pre-wrap wrap-anywhere text-ink">{facts.text}</p>
            </>
          ) : (
            <span className="text-subtle">{t("files.report.none")}</span>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Button hit="tight" onClick={() => void copy(asNote(facts))}>
              {t("files.report.copyNote")}
            </Button>
            <Button hit="tight" onClick={() => void copy(asPrBody(facts))}>
              {t("files.report.copyPr")}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

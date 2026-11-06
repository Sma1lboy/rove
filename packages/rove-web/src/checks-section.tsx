/**
 * The Files pane's merge-readiness section: one line (checks passed, merge and review state), then each CI check
 * with its state, how long it took and how long ago it finished (a running one: how long it has run). A failed
 * Actions job opens its log tail in place. Read on open, on a PR state change and on refresh, never on a timer
 * (`pr.checks` runs `gh`).
 */

import { useEffect, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { AutoFixLine } from "./auto-fix-line.tsx"
import {
  type CheckRow,
  type CheckState,
  type ChecksReply,
  type LogReply,
  checkCounts,
  checkTiming,
  hasChecks,
  mergeParts,
} from "./checks-data.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { lastReply, remember } from "./remembered.ts"
import { Button } from "./ui/button.tsx"
import { CK, CK_AGE, CK_GLYPH, CK_HEAD, CK_LOG, CK_NAME, CK_ROW, CK_TOGGLE } from "./ui/checks.ts"
import { Chevron } from "./ui/chevron.tsx"
import { TONE, type Tone } from "./ui/tone.ts"

const GLYPH: Record<CheckState, { glyph: string; tone: Tone }> = {
  pass: { glyph: "✓", tone: "success" },
  fail: { glyph: "✗", tone: "attention" },
  pending: { glyph: "●", tone: "warning" },
  skipped: { glyph: "–", tone: "muted" },
}

type LogView = { state: "loading" } | { state: "text"; text: string } | { state: "note"; text: string }

function Checks({ model, task }: { model: AppModel; task: TaskRow }) {
  useLocale()
  const pr = task.pr
  const taskId = task.id
  const [reply, setReply] = useState<ChecksReply | null>(
    () => lastReply<ChecksReply>(model, "pr.checks", { taskId }) ?? null,
  )
  const [open, setOpen] = useState<boolean | null>(null)
  const [logs, setLogs] = useState<Readonly<Record<string, LogView>>>({})
  const [refresh, setRefresh] = useState(0)
  // What the poll learned: a change here means the checks moved, so read them again.
  const signature = `${pr?.number}:${pr?.checkState}:${pr?.mergeable}:${pr?.reviewDecision}`

  // biome-ignore lint/correctness/useExhaustiveDependencies: signature and refresh are triggers the body doesn't read
  useEffect(() => {
    let live = true
    const params = { taskId }
    model.client.request<ChecksReply>("pr.checks", refresh > 0 ? { ...params, fresh: true } : params).then(
      (next) => {
        if (!live) return
        remember(model, "pr.checks", params, next)
        setReply(next)
      },
      (err) => live && setReply({ outcome: "unavailable", detail: err instanceof Error ? err.message : String(err) }),
    )
    return () => {
      live = false
    }
  }, [model, taskId, signature, refresh])

  const showLog = (check: CheckRow) => {
    const key = `${check.runId}:${check.name}`
    if (logs[key]) {
      setLogs(({ [key]: _, ...rest }) => rest)
      return
    }
    setLogs((cur) => ({ ...cur, [key]: { state: "loading" } }))
    model.client
      .request<LogReply>("pr.checkLog", { taskId, runId: check.runId, job: check.name })
      .then(
        (res): LogView =>
          res.outcome === "ok"
            ? { state: "text", text: res.tail }
            : res.outcome === "none"
              ? { state: "note", text: t("files.checks.noLog") }
              : { state: "note", text: t("files.checks.logUnavailable", { detail: res.detail }) },
      )
      .catch(
        (err): LogView => ({
          state: "note",
          text: t("files.checks.logUnavailable", { detail: err instanceof Error ? err.message : String(err) }),
        }),
      )
      .then((view) => setLogs((cur) => (key in cur ? { ...cur, [key]: view } : cur)))
  }

  const refreshButton = (
    <Button hit="tight" className="flex-none whitespace-nowrap" onClick={() => setRefresh((n) => n + 1)}>
      {t("files.checks.refresh")}
    </Button>
  )

  if (!reply) {
    return (
      <div className={CK}>
        <div className={CK_HEAD}>
          <span className="flex-1 text-muted">
            {t("files.checks.title")} {t("files.checks.loading")}
          </span>
        </div>
      </div>
    )
  }
  if (reply.outcome !== "ok") {
    return (
      <div className={CK}>
        <div className={CK_HEAD}>
          <span className="min-w-0 flex-1 text-muted wrap-anywhere">
            {reply.outcome === "none"
              ? t("files.checks.none")
              : t("files.checks.unavailable", { detail: reply.detail })}
          </span>
          {refreshButton}
        </div>
      </div>
    )
  }

  const counts = checkCounts(reply.checks)
  const now = Date.now()
  const expanded = open ?? (counts.fail > 0 || counts.pending > 0)
  const merge = mergeParts(reply)
  return (
    <div className={CK}>
      <div className={CK_HEAD}>
        <Button
          variant="row"
          className={CK_TOGGLE}
          aria-expanded={expanded}
          disabled={reply.total === 0}
          onClick={() => setOpen(!expanded)}
        >
          {reply.total > 0 && <Chevron right={!expanded} />}
          <span>
            {reply.total === 0
              ? t("files.checks.none")
              : t("files.checks.summary", { pass: counts.pass + counts.skipped, total: reply.total })}
          </span>
          {counts.fail > 0 && (
            <span className={TONE.attention}>{t("files.checks.failed", { count: counts.fail })}</span>
          )}
          {counts.pending > 0 && (
            <span className={TONE.warning}>{t("files.checks.running", { count: counts.pending })}</span>
          )}
          {merge.map((part) => (
            <span key={part.key} className={TONE[part.tone]}>
              {t(part.key)}
            </span>
          ))}
        </Button>
        {refreshButton}
      </div>
      {expanded &&
        reply.checks.map((check) => {
          const { glyph, tone } = GLYPH[check.state]
          const timing = checkTiming(check, now)
          const key = `${check.runId}:${check.name}`
          const log = logs[key]
          return (
            <div key={`${check.name}:${check.url}`} className="flex flex-col gap-0.5">
              <div className={CK_ROW}>
                <span className={`${CK_GLYPH} ${TONE[tone]}`}>{glyph}</span>
                <span className={CK_NAME} title={check.name}>
                  {check.name}
                </span>
                {timing && <span className={CK_AGE}>{t(timing.key, timing.vars)}</span>}
                {check.state === "fail" && check.runId && (
                  <Button hit="tight" className="flex-none whitespace-nowrap" onClick={() => showLog(check)}>
                    {log ? t("files.checks.hideLog") : t("files.checks.log")}
                  </Button>
                )}
              </div>
              {log && <pre className={CK_LOG}>{log.state === "loading" ? t("files.checks.loading") : log.text}</pre>}
            </div>
          )
        })}
      {expanded && reply.total > reply.checks.length && (
        <span className="pl-4 text-subtle">{t("files.checks.more", { count: reply.total - reply.checks.length })}</span>
      )}
    </div>
  )
}

export function ChecksSection({ model, task }: { model: AppModel; task: TaskRow }) {
  if (!hasChecks(task)) return null
  // The pane's own keys (Enter opens a file row) must not swallow a button's Enter or Space.
  return (
    <div onKeyDown={(e) => e.stopPropagation()}>
      <Checks model={model} task={task} />
      <AutoFixLine model={model} task={task} />
    </div>
  )
}

/**
 * The Compare page: the prompt of one parallel round (`add --count` / `--agents`, one `groupId`), then its attempts
 * side by side, each with its status, latest reply and the diff it wrote. Keep one; its terminal and full diff are
 * a click away. It opens from the round's rail row, a task's menu, or straight after a compare Start. On a phone the
 * attempts stack.
 */

import { useEffect, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import {
  type AttemptChanges,
  type DiffReply,
  type OutputReply,
  attemptChanges,
  attemptsOf,
  replyExcerpt,
} from "./compare-data.ts"
import { CompareDiff } from "./compare-diff.tsx"
import { keepAttempt, unkeepAttempt } from "./compare-keep.tsx"
import { useEngineIcons } from "./engine-icons.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { usePageFocus } from "./pages-kit.ts"
import { openDiff } from "./panel-state.ts"
import { agentless, statusMark } from "./rail-glyphs.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { useStatusMarkStyle } from "./status-mark.ts"
import { useStore } from "./store.ts"
import { compareGroup, page } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { Chip } from "./ui/chip.tsx"
import {
  CMP_ACTIONS,
  CMP_BRANCH,
  CMP_ENGINE,
  CMP_GRID,
  CMP_HEAD,
  CMP_PROMPT,
  CMP_REPLY,
  CMP_SUMMARY,
  cmpColumnClass,
} from "./ui/compare.ts"
import { EngineIcon, type EngineIconData } from "./ui/engine-icon.tsx"
import { PAGE_SCROLL, PAGE_TITLE, PG_TOP } from "./ui/page.ts"
import { StatusDots } from "./ui/status-dots.tsx"
import { PLACEHOLDER_LINE } from "./ui/text.ts"

/** One attempt's latest reply and changes: reread when its status moves or its worktree changes. */
function useAttemptData(model: AppModel, row: TaskRow) {
  const [reply, setReply] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffReply | null>(
    () => lastReply<DiffReply>(model, "diff.files", { taskId: row.id }) ?? null,
  )
  const statusKey = `${row.rowStatus?.kind ?? ""}:${row.rowStatus?.since ?? 0}`
  const changeKey = JSON.stringify(row.changes ?? null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: statusKey is a refetch trigger
  useEffect(() => {
    let live = true
    requestRemembered<OutputReply>(model, "output.read", { taskId: row.id, limit: 8 }).then(
      (res) => live && setReply(replyExcerpt(res)),
      () => live && setReply(null),
    )
    return () => {
      live = false
    }
  }, [model, row.id, statusKey])

  // biome-ignore lint/correctness/useExhaustiveDependencies: changeKey and statusKey are refetch triggers
  useEffect(() => {
    let live = true
    requestRemembered<DiffReply>(model, "diff.files", { taskId: row.id }).then(
      (res) => live && setDiff(res),
      () => {},
    )
    return () => {
      live = false
    }
  }, [model, row.id, changeKey, statusKey])

  return { reply, changes: diff ? attemptChanges(diff) : null, refresh: `${changeKey}|${statusKey}` }
}

/** The change's size, then the change itself; the column's diff action opens the rest. */
function Changes(props: {
  model: AppModel
  row: TaskRow
  changes: AttemptChanges | null
  refresh: string
  onOpen: (path: string) => void
}) {
  const { changes } = props
  if (!changes) return <p className={PLACEHOLDER_LINE}>…</p>
  if (changes.files.length === 0) return <p className="m-0 font-mono text-meta text-subtle">{t("compare.noChanges")}</p>
  return (
    <>
      <p className={CMP_SUMMARY}>
        <span>{t("compare.files", { count: changes.files.length })}</span>
        {changes.added > 0 && <Chip tone="added">+{changes.added}</Chip>}
        {changes.deleted > 0 && <Chip tone="removed">−{changes.deleted}</Chip>}
      </p>
      <CompareDiff
        model={props.model}
        taskId={props.row.id}
        scope={changes.scope}
        refresh={props.refresh}
        onOpen={props.onOpen}
      />
    </>
  )
}

/** The rail's mark for the attempt: its engine's icon (carrying the status when the rail's marks do), or its dots; only dots with no agent behind it. */
function AttemptMark({ model, row, icon }: { model: AppModel; row: TaskRow; icon: EngineIconData | undefined }) {
  const style = useStatusMarkStyle()
  const tabs = useStore(model.tabs)[row.id]
  if (style === "dots" || agentless(row, tabs)) return <StatusDots status={row.rowStatus} />
  return (
    <EngineIcon
      icon={icon}
      name={row.engine?.name}
      status={style === "engine" ? statusMark(row.rowStatus) : undefined}
    />
  )
}

function Attempt(props: {
  model: AppModel
  row: TaskRow
  round: readonly TaskRow[]
  icon: EngineIconData | undefined
}) {
  const { model, row, round } = props
  const { reply, changes, refresh } = useAttemptData(model, row)
  const { look } = statusMark(row.rowStatus)
  const kept = row.kept === true
  // The task's own page: its terminal first, then its diff in the side panel.
  const showDiff = (path: string) => {
    model.select(row.id)
    openDiff({ taskId: row.id, path, scope: changes?.scope ?? "working" })
  }
  return (
    <section className={cmpColumnClass(kept)} data-attempt={row.id} aria-current={kept || undefined}>
      <div className={CMP_HEAD}>
        <AttemptMark model={model} row={row} icon={props.icon} />
        <span className={CMP_ENGINE}>{row.engine?.name ?? row.label}</span>
        <span className="flex-none text-meta text-muted">{t(`compare.status.${look}`)}</span>
        {kept && <span className="ml-auto flex-none font-mono text-meta text-accent">{t("compare.kept")}</span>}
      </div>
      <span className={CMP_BRANCH} title={row.branch}>
        {row.branch}
      </span>
      {reply ? <p className={CMP_REPLY}>{reply}</p> : <p className="m-0 text-muted">{t("compare.noReply")}</p>}
      <Changes model={model} row={row} changes={changes} refresh={refresh} onOpen={showDiff} />
      <div className={CMP_ACTIONS}>
        {kept ? (
          <Button hit="tight" onClick={() => void unkeepAttempt(model, row)}>
            {t("compare.unkeep")}
          </Button>
        ) : (
          <Button variant="filled" onClick={() => void keepAttempt(model, row, round)}>
            {t("compare.keep")}
          </Button>
        )}
        <Button hit="tight" onClick={() => model.select(row.id)}>
          {t("compare.terminal")}
        </Button>
        <Button hit="tight" onClick={() => showDiff(".")}>
          {t("compare.diff")}
        </Button>
      </div>
    </section>
  )
}

/** What the round was asked: every attempt got the same prompt, so the first one's stored brief speaks for all. */
function useRoundPrompt(model: AppModel, taskId: string | undefined): string | null {
  type Reply = { task?: { prompt?: string } }
  const [prompt, setPrompt] = useState<string | null>(() =>
    taskId ? (lastReply<Reply>(model, "task.get", { taskId })?.task?.prompt ?? null) : null,
  )
  useEffect(() => {
    if (!taskId) return
    let live = true
    requestRemembered<Reply>(model, "task.get", { taskId }).then(
      (res) => live && setPrompt(res.task?.prompt?.trim() || null),
      () => {},
    )
    return () => {
      live = false
    }
  }, [model, taskId])
  return prompt
}

export function CompareView({ model }: { model: AppModel }) {
  useLocale()
  const groupId = useStore(compareGroup)
  const payload = useStore(model.tasks)
  const root = usePageFocus()
  const icons = useEngineIcons(model)
  const round = groupId && payload ? attemptsOf(payload.tasks, groupId) : []
  const prompt = useRoundPrompt(model, round[0]?.id)
  return (
    <div
      className={PAGE_SCROLL}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
      tabIndex={0}
      ref={root}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "q" && e.key !== "Escape")) return
        e.preventDefault()
        page.set(null)
      }}
    >
      <div className={PG_TOP}>
        <h1 className={PAGE_TITLE}>{t("compare.title")}</h1>
        {round.length > 0 && (
          <span className="flex-none font-mono text-meta text-muted">
            {t("compare.attempts", { count: round.length })}
          </span>
        )}
      </div>
      {prompt && (
        <p className={CMP_PROMPT} title={prompt}>
          {prompt}
        </p>
      )}
      {round.length === 0 ? (
        <p className="text-muted">{t("compare.empty")}</p>
      ) : (
        <div className={CMP_GRID}>
          {round.map((row) => (
            <Attempt key={row.id} model={model} row={row} round={round} icon={icons.get(row.engine?.id ?? "")} />
          ))}
        </div>
      )}
    </div>
  )
}

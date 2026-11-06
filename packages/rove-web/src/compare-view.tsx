/**
 * The Compare page: the attempts of one parallel round (`add --count` / `--agents`, one `groupId`) side by side,
 * each with its status, latest reply and changed files. Open an attempt's terminal or diff, keep one. It has no
 * rail row: it opens from a task's menu, or straight after a compare Start. On a phone the attempts stack.
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
import { keepAttempt, unkeepAttempt } from "./compare-keep.tsx"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { usePageFocus } from "./pages-kit.ts"
import { openDiff } from "./panel-state.ts"
import { statusMark } from "./rail-glyphs.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { useStore } from "./store.ts"
import { compareGroup, page } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { Chip } from "./ui/chip.tsx"
import {
  CMP_ACTIONS,
  CMP_BRANCH,
  CMP_ENGINE,
  CMP_FILE,
  CMP_FILES,
  CMP_GRID,
  CMP_HEAD,
  CMP_REPLY,
  cmpColumnClass,
} from "./ui/compare.ts"
import { PAGE_SCROLL, PAGE_TITLE } from "./ui/page.ts"
import { StatusDots } from "./ui/status-dots.tsx"
import { PLACEHOLDER_LINE } from "./ui/text.ts"

/** Files listed per attempt; the diff has the rest. */
const FILES_SHOWN = 6

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

  return { reply, changes: diff ? attemptChanges(diff) : null }
}

function ChangedFiles({
  changes,
  onOpen,
}: { changes: AttemptChanges | null; onOpen: (path: string, scope: AttemptChanges["scope"]) => void }) {
  if (!changes) return <p className={PLACEHOLDER_LINE}>…</p>
  if (changes.files.length === 0) return <p className="m-0 font-mono text-meta text-subtle">{t("compare.noChanges")}</p>
  const more = changes.files.length - FILES_SHOWN
  return (
    <div className={CMP_FILES}>
      <p className="m-0 flex gap-2 font-mono text-meta text-muted">
        <span>{t("compare.files", { count: changes.files.length })}</span>
        {changes.added > 0 && <Chip tone="added">+{changes.added}</Chip>}
        {changes.deleted > 0 && <Chip tone="removed">−{changes.deleted}</Chip>}
      </p>
      {changes.files.slice(0, FILES_SHOWN).map((file) => (
        <Button
          key={file.path}
          variant="row"
          className={`${CMP_FILE} text-left [&:hover]:underline`}
          title={file.path}
          onClick={() => onOpen(file.path, changes.scope)}
        >
          <span className="min-w-0 flex-1 truncate">{file.path}</span>
          {file.added ? <Chip tone="added">+{file.added}</Chip> : null}
          {file.deleted ? <Chip tone="removed">−{file.deleted}</Chip> : null}
        </Button>
      ))}
      {more > 0 && <span className="font-mono text-meta text-subtle">{t("compare.more", { count: more })}</span>}
    </div>
  )
}

function Attempt({ model, row, round }: { model: AppModel; row: TaskRow; round: readonly TaskRow[] }) {
  const { reply, changes } = useAttemptData(model, row)
  const { look } = statusMark(row.rowStatus)
  const kept = row.kept === true
  // The task's own page: its terminal first, then its diff in the side panel.
  const showDiff = (path: string, scope: AttemptChanges["scope"]) => {
    model.select(row.id)
    openDiff({ taskId: row.id, path, scope })
  }
  return (
    <section className={cmpColumnClass(kept)} data-attempt={row.id}>
      <div className={CMP_HEAD}>
        <StatusDots status={row.rowStatus} />
        <span className={CMP_ENGINE}>{row.engine?.name ?? row.label}</span>
        <span className="flex-none text-meta text-muted">{t(`compare.status.${look}`)}</span>
        {kept && <span className="ml-auto flex-none font-mono text-meta text-accent">{t("compare.kept")}</span>}
      </div>
      <span className={CMP_BRANCH} title={row.branch}>
        {row.branch}
      </span>
      {reply ? <p className={CMP_REPLY}>{reply}</p> : <p className="m-0 text-muted">{t("compare.noReply")}</p>}
      <ChangedFiles changes={changes} onOpen={showDiff} />
      <div className={CMP_ACTIONS}>
        <Button hit="tight" onClick={() => model.select(row.id)}>
          {t("compare.terminal")}
        </Button>
        <Button hit="tight" onClick={() => showDiff(".", changes?.scope ?? "working")}>
          {t("compare.diff")}
        </Button>
        {kept ? (
          <Button hit="tight" onClick={() => void unkeepAttempt(model, row)}>
            {t("compare.unkeep")}
          </Button>
        ) : (
          <Button hit="tight" onClick={() => void keepAttempt(model, row, round)}>
            {t("compare.keep")}
          </Button>
        )}
      </div>
    </section>
  )
}

export function CompareView({ model }: { model: AppModel }) {
  useLocale()
  const groupId = useStore(compareGroup)
  const payload = useStore(model.tasks)
  const root = usePageFocus()
  const round = groupId && payload ? attemptsOf(payload.tasks, groupId) : []
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
      <h1 className={PAGE_TITLE}>{t("compare.title")}</h1>
      {round.length === 0 ? (
        <p className="text-muted">{t("compare.empty")}</p>
      ) : (
        <div className={CMP_GRID}>
          {round.map((row) => (
            <Attempt key={row.id} model={model} row={row} round={round} />
          ))}
        </div>
      )}
    </div>
  )
}

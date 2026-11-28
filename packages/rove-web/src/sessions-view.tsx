/**
 * The Sessions page: one project's sessions, or every project's, as Active and Archived lists. It is where an
 * archived session is seen again, since the rail lists none; a row opens its session and carries the rail's row menu
 * (Unarchive, Remove). Opens from a project header. j/k move, Tab cycles projects, `a` flips the list,
 * Enter opens, q/Esc close.
 */

import { relativeAge } from "@sma1lboy/rove-core/lib/relative-time.ts"
import { useEffect, useRef, useState } from "react"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { projectLabel, repoKey, useCopy, usePageKeys } from "./pages-kit.ts"
import { openMenu } from "./rail-view.tsx"
import { isNoProject } from "./rail.ts"
import { taskMenu } from "./row-actions.tsx"
import { type SessionsTab, sessionRepos, sessionRows } from "./sessions-data.ts"
import { useStore } from "./store.ts"
import { page, sessionsRepo, tuckRare } from "./ui.ts"
import {
  PAGE_SCROLL,
  PAGE_TITLE,
  PG_GROW,
  PG_ISSUE_LINE,
  PG_ISSUE_NUM,
  PG_LIST,
  PG_TOP,
  pgHintClass,
  pgIssueClass,
} from "./ui/page.ts"
import { Tabs } from "./ui/tabs.tsx"

export function SessionsView({ model }: { model: AppModel }) {
  const { common } = useCopy()
  const payload = useStore(model.tasks)
  const scope = useStore(sessionsRepo) ?? ""
  const [tab, setTab] = useState<SessionsTab>("active")
  const [cursor, setCursor] = useState(0)
  const repos = sessionRepos(payload)
  const repo = scope === "" ? null : scope
  const rows = sessionRows(payload, repo, tab)
  const at = Math.min(cursor, Math.max(0, rows.length - 1))

  const root = useRef<HTMLDivElement>(null)
  useEffect(() => root.current?.focus(), [])
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" })
  }, [at])

  const open = (taskId: string) => {
    page.set(null)
    model.select(taskId)
  }
  const flip = (next: SessionsTab) => {
    setTab(next)
    setCursor(0)
  }
  const cycle = (back: boolean) => {
    const scopes = ["", ...repos]
    const here = scopes.findIndex((s) => (s === "" ? scope === "" : repoKey(s) === repoKey(scope)))
    sessionsRepo.set(scopes[(Math.max(0, here) + (back ? scopes.length - 1 : 1)) % scopes.length] ?? "")
    setCursor(0)
  }

  usePageKeys((e) => {
    if (e.ctrlKey) {
      if (e.key !== "c") return false
      page.set(null)
      return true
    }
    const row = rows[at]
    switch (e.key) {
      case "Escape":
      case "q":
        page.set(null)
        return true
      case "j":
      case "ArrowDown":
        setCursor(Math.min(rows.length - 1, at + 1))
        return true
      case "k":
      case "ArrowUp":
        setCursor(Math.max(0, at - 1))
        return true
      case "Tab":
        cycle(e.shiftKey)
        return true
      case "a":
        flip(tab === "active" ? "archived" : "active")
        return true
      case "Enter":
        if (row) open(row.id)
        return true
      default:
        return false
    }
  })

  const now = Date.now()
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className={`group/pane ${PAGE_SCROLL}`} tabIndex={0} ref={root}>
      <div className={PG_TOP}>
        <div className="flex min-w-0 items-center gap-3">
          <h1 className={PAGE_TITLE}>{t("sessions.title")}</h1>
          <Tabs
            tabs={[
              { id: "active", label: t("sessions.active") },
              { id: "archived", label: t("sessions.archived") },
            ]}
            value={tab}
            onChange={flip}
          />
        </div>
        <span className={`mono touch:empty:hidden! text-muted ${pgHintClass(true)}`}>
          {repo ? projectLabel(repo, repos) : t("sessions.allProjects")}
        </span>
      </div>
      {!payload ? (
        <p className="text-muted">{common.loading}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">{t(tab === "archived" ? "sessions.emptyArchived" : "sessions.emptyActive")}</p>
      ) : (
        <div className={PG_LIST} ref={list}>
          {rows.map((task, index) => {
            const changed = Date.parse(task.updatedAt ?? task.createdAt ?? "")
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the page's keys (j/k, Enter) drive the list
              <div
                key={task.id}
                data-row={index}
                className={pgIssueClass(index === at)}
                onClick={() => open(task.id)}
                onContextMenu={(e) => {
                  setCursor(index)
                  openMenu(e, tuckRare(taskMenu(model, task, null), t("menu.more")))
                }}
              >
                <div className={PG_ISSUE_LINE}>
                  <span className={PG_GROW} title={task.label}>
                    {task.label}
                  </span>
                  {repo === null && !isNoProject(task) ? (
                    <span className={`mono text-meta ${PG_ISSUE_NUM}`}>{projectLabel(task.repo, repos)}</span>
                  ) : null}
                  <span className={`mono text-meta ${PG_ISSUE_NUM}`}>
                    {Number.isFinite(changed) ? relativeAge(changed, now) : ""}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="mt-2.5 mb-0 text-meta text-subtle touch:hidden">{t("sessions.keys")}</p>
    </div>
  )
}

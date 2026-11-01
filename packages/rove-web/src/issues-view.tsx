/**
 * The GitHub Issues page (TUI `work-items-page.tsx`): a project's issues, read-only, through the
 * daemon's `gh` listing. j/k or arrows move, Tab cycles projects, `a` filters to issues assigned
 * to me, `r` forces past the daemon's 60 s cache, Enter starts a task on the issue (or opens the
 * task already started from it), q/Esc close. Nothing here writes to GitHub.
 */

import { relativeAge } from "@sma1lboy/rove/src/lib/relative-time.ts"
import { useEffect, useRef, useState } from "react"
import type { AppModel } from "./model.ts"
import {
  errorMessage,
  fill,
  projectLabel,
  repoKey,
  useCopy,
  usePageFocus,
  usePageKeys,
  useSelectedRepo,
  useTaskRepos,
} from "./pages-kit.ts"
import { lastReply, remember, requestRemembered } from "./remembered.ts"
import { useStore } from "./store.ts"
import { page, toast } from "./ui.ts"
import {
  PAGE_SCROLL,
  PAGE_TITLE,
  PG_GROW,
  PG_ISSUE_LINE,
  PG_ISSUE_NUM,
  PG_ISSUE_SUB,
  PG_LIST,
  PG_NOTICE,
  PG_TOP,
  pgHintClass,
  pgIssueClass,
} from "./ui/page.ts"

const LIMIT = 30

interface WorkItem {
  readonly number: number
  readonly title: string
  readonly author?: string
  readonly labels: readonly string[]
  readonly updatedAt: string
}

/** A `gh` failure names its fix: `no-remote`, `gh-missing` and `auth` get their own hint. */
function useErrorHint() {
  const { items } = useCopy()
  return (error: string) => {
    const colon = error.indexOf(": ")
    switch (colon >= 0 ? error.slice(0, colon) : "failed") {
      case "no-remote":
        return items.errorHint.noRemote
      case "gh-missing":
        return items.errorHint.ghMissing
      case "auth":
        return items.errorHint.auth
      default:
        return fill(items.errorHint.fallback, { message: error })
    }
  }
}

export function IssuesView({ model }: { model: AppModel }) {
  const { items: copy, common } = useCopy()
  const hint = useErrorHint()
  const c = model.client
  const payload = useStore(model.tasks)
  const repos = useTaskRepos(model)
  const focusRepo = useSelectedRepo(model)
  const [repoIndex, setRepoIndex] = useState(() => {
    const at = focusRepo ? repos.findIndex((repo) => repoKey(repo) === repoKey(focusRepo)) : -1
    return Math.max(0, at)
  })
  const repo = repos[repoIndex]
  // A repo's list (and its linked tasks) as last read shows at once; the reread replaces it.
  const listKey = (forRepo: string, onlyMine: boolean) => ({
    repo: forRepo,
    limit: LIMIT,
    ...(onlyMine ? { assignee: "@me" } : {}),
  })
  type Links = { links: { number: number; taskId: string }[] }
  const linkMap = (reply: Links) => Object.fromEntries(reply.links.map((link) => [link.number, link.taskId]))
  const [items, setItems] = useState<readonly WorkItem[] | null>(() =>
    repo ? (lastReply<{ items: WorkItem[] }>(c, "workitem.list", listKey(repo, false))?.items ?? null) : null,
  )
  const [links, setLinks] = useState<Readonly<Record<number, string>>>(() => {
    const last = repo ? lastReply<Links>(c, "workitem.links", { repo }) : undefined
    return last ? linkMap(last) : {}
  })
  const [error, setError] = useState<string | null>(null)
  const [mine, setMine] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const root = usePageFocus()
  // Only `r` bypasses the cache; a repo switch or filter toggle stays instant.
  const refresh = useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick is a trigger the body doesn't read
  useEffect(() => {
    let live = true
    if (!repo) {
      setItems([])
      return
    }
    setError(null)
    const forced = refresh.current
    refresh.current = false
    const key = listKey(repo, mine)
    const last = lastReply<{ items: WorkItem[] }>(c, "workitem.list", key)
    if (last) setItems(last.items)
    c.request<{ items: WorkItem[] }>("workitem.list", { ...key, ...(forced ? { refresh: true } : {}) })
      .then((res) => live && setItems(remember(c, "workitem.list", key, res).items))
      .catch((err: unknown) => {
        if (!live) return
        setError(errorMessage(err))
        setItems([])
      })
    requestRemembered<Links>(c, "workitem.links", { repo })
      .then((res) => live && setLinks(linkMap(res)))
      .catch(() => live && setLinks({}))
    return () => {
      live = false
    }
  }, [c, repo, mine, reloadTick, payload?.tasks.length])

  const rows = items ?? []
  const at = Math.min(cursor, Math.max(0, rows.length - 1))
  // A repo switch or filter toggle stales the notice; nothing else clears it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: repo/filter are triggers
  useEffect(() => setNotice(null), [repo, mine])
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" })
  }, [at])

  const titleOf = (taskId: string) => payload?.tasks.find((task) => task.id === taskId)?.title ?? taskId
  const openTask = (taskId: string) => {
    page.set(null)
    model.select(taskId)
  }

  const startSelected = async () => {
    const item = rows[at]
    if (!item || !repo || starting) return
    // The daemon creates unconditionally by contract; the dedup lives here.
    const linked = links[item.number]
    if (linked) {
      setNotice(fill(copy.openingLinked, { title: titleOf(linked) }))
      openTask(linked)
      return
    }
    setStarting(true)
    setNotice(fill(copy.starting, { number: item.number }))
    try {
      const res = await c.request<{ started: boolean; taskId: string; title: string }>("workitem.start", {
        repo,
        number: item.number,
      })
      if (res.started) openTask(res.taskId)
      // The task exists even when its engine did not come up; say so.
      else setNotice(fill(copy.startedNoEngine, { title: res.title }))
    } catch (err) {
      toast(fill(copy.startFailed, { number: item.number, error: errorMessage(err) }), "error")
    } finally {
      setStarting(false)
    }
  }

  usePageKeys((e) => {
    if (e.ctrlKey) {
      if (e.key !== "c") return false
      page.set(null)
      return true
    }
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
        setRepoIndex((i) => (repos.length ? (i + (e.shiftKey ? repos.length - 1 : 1)) % repos.length : 0))
        return true
      case "a":
        setMine((on) => !on)
        return true
      case "r":
        refresh.current = true
        setReloadTick((n) => n + 1)
        return true
      case "Enter":
        void startSelected()
        return true
      default:
        return false
    }
  })

  const now = Date.now()
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className={PAGE_SCROLL} tabIndex={0} ref={root}>
      <div className={PG_TOP}>
        <h1 className={PAGE_TITLE}>{copy.title}</h1>
        <span className={`muted mono touch:empty:hidden! ${pgHintClass(true)}`}>
          {repo ? projectLabel(repo, repos) : copy.noRepo}
          {mine ? `  ${copy.assignedFilter}` : ""}
        </span>
      </div>
      {error ? (
        <div className={PG_LIST}>
          <p className="error">{error}</p>
          <p className="muted">{hint(error)}</p>
        </div>
      ) : items === null ? (
        <p className="muted">{common.loading}</p>
      ) : rows.length === 0 ? (
        <p className="muted">{copy.empty}</p>
      ) : (
        <div className={PG_LIST} ref={list}>
          {rows.map((item, index) => {
            const linked = links[item.number]
            const updated = Date.parse(item.updatedAt)
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the page's keys (j/k) move the cursor
              <div
                key={item.number}
                data-row={index}
                className={pgIssueClass(index === at)}
                onClick={() => (index === at ? void startSelected() : setCursor(index))}
              >
                <div className={PG_ISSUE_LINE}>
                  <span className={`mono ${PG_ISSUE_NUM}`}>#{item.number}</span>
                  <span>{item.title}</span>
                </div>
                <div className={PG_ISSUE_SUB}>
                  <span className={PG_GROW}>
                    {[item.author, ...item.labels.slice(0, 2)].filter(Boolean).join(", ")}
                  </span>
                  {linked && <span>{fill(copy.linkedChip, { title: titleOf(linked) })}</span>}
                  <span className="mono">{Number.isFinite(updated) ? relativeAge(updated, now) : ""}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {notice && <p className={`muted ${PG_NOTICE}`}>{notice}</p>}
    </div>
  )
}

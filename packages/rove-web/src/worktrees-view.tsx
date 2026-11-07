/**
 * The Worktrees page (TUI `worktrees-page.tsx`): every git worktree of every saved project
 * with the TUI's badges, over the workspace. `j`/`k` move, `d` deletes (a dirty refusal offers
 * the force confirm with the daemon's reason), `l` lands the row's task, `q`/Esc close. Copy
 * is the TUI's own `worktrees.*` catalog.
 */

import { en as wtEn, zh as wtZh } from "@sma1lboy/rove/src/tui/i18n/messages/worktrees.ts"
import { useCallback, useEffect, useRef, useState } from "react"
import { ConfirmDialog, errorText } from "./dialogs.tsx"
import { useLocale } from "./i18n/index.ts"
import { compactAge } from "./inbox.ts"
import type { AppModel } from "./model.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { landFlow } from "./task-flows.tsx"
import { dialog, page, toast } from "./ui.ts"
import { Legend } from "./ui/legend.tsx"
import { PAGE_SCROLL, PAGE_TITLE } from "./ui/page.ts"
import { LINK } from "./ui/text.ts"
import { WT_BRANCH, WT_GROUP, WT_HINTS, WT_LINE, WT_LINE_META, WT_PATH, wtRowClass } from "./ui/update.ts"

interface WorktreeRow {
  readonly path: string
  readonly branch: string
  readonly dirty: boolean | null
  readonly roveManaged: boolean
  readonly createdAtMs: number
  readonly branchOnRemote: boolean | null
  readonly verdict: string
  readonly verdictReason: string
  readonly taskId?: string
}

interface Project {
  readonly repo: string
  readonly worktrees: readonly WorktreeRow[]
}

function fill(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => String(params[k] ?? m))
}

export function WorktreesView({ model }: { model: AppModel }) {
  const lang = useLocale()
  const w = lang === "zh" ? wtZh : wtEn
  const c = model.client
  // The list as last read shows at once (the full pass if one landed), and both passes reread it.
  const [projects, setProjects] = useState<readonly Project[] | null>(() => {
    const last =
      lastReply<{ projects: Project[] }>(c, "worktrees.list", { network: true }) ??
      lastReply<{ projects: Project[] }>(c, "worktrees.list", { network: false })
    return last?.projects ?? null
  })
  const [removing, setRemoving] = useState<readonly string[]>([])
  const [cursor, setCursor] = useState(0)
  const [tick, setTick] = useState(0)
  const host = useRef<HTMLDivElement>(null)

  // Two passes as the TUI: local signals first, then the slow remote/PR lookups.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a trigger the body doesn't read
  useEffect(() => {
    let live = true
    let full = false
    const load = (network: boolean) =>
      requestRemembered<{ projects: Project[] }>(c, "worktrees.list", { network })
        .then((r) => {
          if (!live || (!network && full)) return
          if (network) full = true
          setProjects(r.projects)
          if (network) {
            const listed = new Set(r.projects.flatMap((p) => p.worktrees.map((x) => x.path)))
            setRemoving((paths) => paths.filter((p) => listed.has(p)))
          }
        })
        .catch(() => {})
    void load(false)
    void load(true)
    return () => {
      live = false
    }
  }, [c, tick])
  useEffect(() => host.current?.focus(), [])

  const visible = (projects ?? []).map((p) => ({
    ...p,
    worktrees: p.worktrees.filter((x) => !removing.includes(x.path)),
  }))
  const rows = visible.flatMap((p) => p.worktrees)
  const at = Math.min(cursor, Math.max(0, rows.length - 1))
  useEffect(() => {
    host.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" })
  }, [at])
  const refetch = useCallback(() => setTick((n) => n + 1), [])

  const remove = async (row: WorktreeRow, force: boolean): Promise<void> => {
    setRemoving((paths) => [...paths, row.path])
    try {
      const res = await c.request<{ residue?: { path: string; reason: string } }>("worktrees.remove", {
        path: row.path,
        force,
      })
      if (res.residue) toast(fill(w.delete.residue, res.residue))
      refetch()
    } catch (err) {
      setRemoving((paths) => paths.filter((p) => p !== row.path))
      const code = err && typeof err === "object" && "code" in err ? err.code : null
      if (!force && code === "DIRTY_WORKTREE") {
        dialog.set(
          <ConfirmDialog
            title={w.delete.forceTitle}
            body={`${fill(w.delete.forceBody, { branch: row.branch || row.path })}\n\n${fill(w.delete.forceReason, { reason: errorText(err) })}`}
            confirmLabel={w.delete.button}
            onConfirm={() => remove(row, true)}
          />,
        )
        return
      }
      toast(fill(w.delete.failed, { error: errorText(err) }), "error")
    }
  }

  const requestDelete = (row: WorktreeRow) =>
    dialog.set(
      <ConfirmDialog
        title={w.delete.confirmTitle}
        body={fill(w.delete.confirmBody, { branch: row.branch || row.path })}
        confirmLabel={w.delete.button}
        onConfirm={async () => {
          void remove(row, false)
        }}
      />,
    )

  const requestLand = (row: WorktreeRow) => {
    if (!row.taskId) {
      toast(w.land.noTask, "error")
      return
    }
    void landFlow(model, { id: row.taskId, title: row.branch, branch: row.branch }, refetch)
  }

  const onKey = (e: React.KeyboardEvent) => {
    // Ctrl+C closes, as the TUI's page bindings; a text selection keeps the browser's copy.
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
      e.preventDefault()
      return page.set(null)
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const row = rows[at]
    if (e.key === "j" || e.key === "ArrowDown") setCursor(Math.min(rows.length - 1, at + 1))
    else if (e.key === "k" || e.key === "ArrowUp") setCursor(Math.max(0, at - 1))
    else if (e.key === "d" && row) requestDelete(row)
    else if (e.key === "l" && row) requestLand(row)
    else if (e.key === "q" || e.key === "Escape") page.set(null)
    else return
    e.preventDefault()
  }

  let base = 0
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className={PAGE_SCROLL} tabIndex={0} ref={host} onKeyDown={onKey}>
      <h1 className={PAGE_TITLE}>{w.title}</h1>
      {projects === null ? (
        <p className="text-muted">{w.loading}</p>
      ) : visible.length === 0 ? (
        <p className="text-muted">{w.noProjects}</p>
      ) : (
        visible.map((project) => {
          const start = base
          base += project.worktrees.length
          return (
            <section key={project.repo} className={WT_GROUP}>
              <h2 className="mt-1.5 mr-2 mb-1 ml-0 flex items-center gap-1 font-mono text-meta font-semibold normal-nums text-subtle">
                <span>{project.repo}</span>
                <span className="rule" />
              </h2>
              {project.worktrees.length === 0 && <p className="mono text-muted">{w.noWorktrees}</p>}
              {project.worktrees.map((row, i) => {
                const n = start + i
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the page's keys (j/k) move the cursor
                  <div key={row.path} data-row={n} className={wtRowClass(n === at)} onClick={() => setCursor(n)}>
                    <div className={WT_LINE}>
                      <span className={WT_BRANCH}>{row.branch || w.row.detached}</span>
                      {row.roveManaged && <span className="chip text-muted">{w.badge.roveManaged}</span>}
                      {row.dirty === true && <span className="chip text-warning">{w.badge.dirty}</span>}
                      {row.dirty === null && <span className="chip text-muted">{w.badge.dirtyUnknown}</span>}
                      <span
                        className={`chip ${row.branchOnRemote === true ? "text-success" : row.branchOnRemote === false ? "text-warning" : "text-muted"}`}
                      >
                        {row.branchOnRemote === true
                          ? w.badge.remoteOn
                          : row.branchOnRemote === false
                            ? w.badge.remoteOff
                            : w.badge.remoteUnknown}
                      </span>
                      {row.verdictReason !== "dirty" && row.verdictReason !== "fresh" && (
                        <span
                          className={`chip ${row.verdict === "merged" ? "text-success" : row.verdict === "stale" ? "text-warning" : "text-accent"}`}
                        >
                          {(w.verdict as Record<string, string>)[row.verdictReason] ?? row.verdictReason}
                        </span>
                      )}
                    </div>
                    <div className={`${WT_LINE_META} mono text-muted`}>
                      <span className={WT_PATH}>{row.path}</span>
                      {row.createdAtMs > 0 && (
                        <span>{fill(w.row.created, { age: compactAge(Date.now() - row.createdAtMs) })}</span>
                      )}
                    </div>
                    {n === at && (
                      <div className={WT_LINE}>
                        <button type="button" className={LINK} onClick={() => requestDelete(row)}>
                          {w.delete.button}
                        </button>
                        {row.taskId && (
                          <button type="button" className={LINK} onClick={() => requestLand(row)}>
                            {w.land.button}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          )
        })
      )}
      <p className={`${WT_HINTS} mono keys-only text-muted`}>
        <Legend text={`j/k · d ${w.delete.button} · l ${w.land.button} · q/esc`} />
      </p>
    </div>
  )
}

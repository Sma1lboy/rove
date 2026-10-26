/**
 * What the Kanban, Routines and GitHub Issues pages share: the TUI's own copy for each
 * (`kanban.*`, `automations.*`, `workItems.*`, `tasks.nav`, `tasks.group`), the project
 * list, a poll clock, and the page-key rule (the TUI gates bare keys on the content pane
 * having focus, so the rail's `n`/`d` never reach a page and the page's never reach the rail).
 */

import { en as autoEn, zh as autoZh } from "@sma1lboy/rove/src/tui/i18n/messages/automations.ts"
import { en as commonEn, zh as commonZh } from "@sma1lboy/rove/src/tui/i18n/messages/common.ts"
import { en as kanbanEn, zh as kanbanZh } from "@sma1lboy/rove/src/tui/i18n/messages/kanban.ts"
import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { en as itemsEn, zh as itemsZh } from "@sma1lboy/rove/src/tui/i18n/messages/workItems.ts"
import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { isNoProject } from "./rail.ts"
import { useStore } from "./store.ts"
import { dialog, menu } from "./ui.ts"

export function useCopy() {
  const zh = useLocale() === "zh"
  return {
    kanban: zh ? kanbanZh : kanbanEn,
    auto: zh ? autoZh : autoEn,
    items: zh ? itemsZh : itemsEn,
    nav: (zh ? tasksZh : tasksEn).nav,
    group: (zh ? tasksZh : tasksEn).group,
    common: zh ? commonZh : commonEn,
  }
}

export function fill(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => String(params[k] ?? m))
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** `/private/tmp/x` and `/tmp/x` are one project on macOS (the TUI strips the prefix the same way). */
export function repoKey(repo: string): string {
  return repo.replace(/^\/private\//, "/").replace(/\/+$/, "")
}

/** The project's name; a clash adds the parent folder (the TUI's `sidebarProjectLabel`). */
export function projectLabel(repo: string, all: readonly string[]): string {
  const parts = repo.split("/").filter(Boolean)
  const base = parts[parts.length - 1] ?? repo
  const clash = all.some((other) => other !== repo && other.split("/").filter(Boolean).pop() === base)
  return clash && parts.length > 1 ? `${parts[parts.length - 2]}/${base}` : base
}

/** Every project the page can show: the caller's remote reads first, then the live tasks' repos. */
export function mergeRepos(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const repo of lists.flat()) {
    // `ssh://` keys are remote projects; the stores here are keyed by local git path.
    if (!repo || repo.startsWith("ssh://")) continue
    const key = repoKey(repo)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(repo)
  }
  return out
}

/** Live task repos, newest feed first (the TUI's `listTasks().map(repo)`). */
export function useTaskRepos(model: AppModel): string[] {
  const payload = useStore(model.tasks)
  return mergeRepos((payload?.tasks ?? []).filter((task) => !isNoProject(task)).map((task) => task.repo))
}

/** The repo of the selected task: the project every page opens on. */
export function useSelectedRepo(model: AppModel): string | undefined {
  const payload = useStore(model.tasks)
  const { taskId } = useStore(model.selection)
  return payload?.tasks.find((task) => task.id === taskId)?.repo
}

/** A counter that bumps every `ms` and on demand: the TUI pages' `reloadTick` + poll. */
export function useReload(ms: number): readonly [number, () => void] {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), ms)
    return () => window.clearInterval(timer)
  }, [ms])
  return [tick, useCallback(() => setTick((n) => n + 1), [])]
}

function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
}

/**
 * Page keys, live only while the content pane owns the keyboard: no dialog or menu open, focus
 * not in the rail, the Files pane or a text field. Window-level so a closed dialog (focus back
 * on the body) doesn't strand the page. Return true when the key was taken.
 */
export function usePageKeys(onKey: (e: KeyboardEvent) => boolean): void {
  const latest = useRef(onKey)
  latest.current = onKey
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.defaultPrevented || dialog.get() || menu.get()) return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (typingInField(target) || target?.closest(".rail, .files, .xterm")) return
      if (e.metaKey || e.altKey) return
      // Ctrl+C closes a page only when nothing is selected; a text selection keeps the browser's copy.
      if (e.ctrlKey && e.key.toLowerCase() === "c" && window.getSelection()?.toString()) return
      if (latest.current(e)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener("keydown", handle)
    return () => window.removeEventListener("keydown", handle)
  }, [])
}

/** The page root takes focus when it mounts, like the TUI's `goToNav` focusing the content pane. */
export function usePageFocus() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return ref
}

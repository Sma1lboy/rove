/** @jsxImportSource @opentui/react */
/**
 * WorkItemsPage — a repo's GitHub issues, and one key to start work on one.
 *
 * Same page shape as {@link WorktreesPage} / {@link AutomationsPage}. What is
 * specific here is that the list is a view of someone else's data: nothing on
 * this page edits the tracker, and `r` forces past the daemon's 60s cache
 * because "is this list current" is a question only the user can answer.
 *
 * Enter is the whole point of the page — it creates a task whose branch derives
 * from the issue title and whose engine opens with the issue already in hand,
 * replacing copy-title → invent-branch → create-task → paste-body. An issue
 * that already has a task (`task.linkedWorkItem`) shows that task on its
 * detail line, and enter opens it instead of minting a duplicate.
 */

import { TextAttributes } from "@opentui/core"
import type { WorkItem } from "@sma1lboy/kobe-daemon/daemon/work-items"
import { type ReactNode, useEffect, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { errorMessage } from "../../lib/error-message"
import { clampCursor } from "../../tui/component/new-task-dialog/state"
import { sidebarProjectLabel } from "../../tui/panes/sidebar/groups"
import type { Task } from "../../types/task"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { useCursorFollow } from "../lib/use-cursor-follow"
import { resolveRowSelectionChrome } from "../ui/row-selection-chrome"

/** Repos the user has open, newest-activity first — the source picker. */
function reposOf(orch: RemoteOrchestrator | null): string[] {
  if (!orch) return []
  const seen: string[] = []
  for (const task of orch.listTasks()) {
    if (task.repo && !seen.includes(task.repo)) seen.push(task.repo)
  }
  return seen
}

/** The task already started from `number` on `repo`, if any. */
function linkedTaskFor(orch: RemoteOrchestrator | null, repo: string, number: number): Task | undefined {
  return orch?.listTasks().find((task) => task.repo === repo && task.linkedWorkItem?.number === number)
}

function errorHint(error: string, t: ReturnType<typeof useT>): string {
  const colon = error.indexOf(": ")
  const kind = colon >= 0 ? error.slice(0, colon) : "failed"
  switch (kind) {
    case "no-remote":
      return t("workItems.errorHint.noRemote")
    case "gh-missing":
      return t("workItems.errorHint.ghMissing")
    case "auth":
      return t("workItems.errorHint.auth")
    default:
      return t("workItems.errorHint.fallback", { message: error })
  }
}

function relativeAge(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return ""
  const mins = Math.round((now - at) / 60_000)
  if (mins < 60) return `${Math.max(mins, 0)}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export function WorkItemsPage(props: {
  orchestrator: RemoteOrchestrator | null
  onClose: () => void
  /** False while another pane holds focus — the page shares the window now,
   *  so its bare j/k/d must not fire while the sidebar is focused. */
  focused?: boolean
  /** Land on the started task's workspace. */
  onOpenTask?: (taskId: string) => void
  /** Repo to open on; falls back to the first repo with tasks. */
  focusRepo?: string
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  // Failure toasts, not the muted inline notice — same contract as the
  // Worktrees/Automations pages (see AutomationsPage for the rationale).
  const notif = useNotifications()
  function notifyError(message: string): void {
    notif.notify({ kind: "error", taskId: "", tabId: "", title: message })
  }

  const repos = reposOf(props.orchestrator)
  const [repoIndex, setRepoIndex] = useState(() => {
    const wanted = props.focusRepo ? repos.indexOf(props.focusRepo) : -1
    return wanted >= 0 ? wanted : 0
  })
  const repo = repos[repoIndex]

  const [items, setItems] = useState<readonly WorkItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [assignedToMe, setAssignedToMe] = useState(false)
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    const orch = props.orchestrator
    if (!orch || !repo) {
      setItems([])
      return
    }
    setError(null)
    void orch
      .listWorkItems({
        repo,
        limit: 30,
        ...(assignedToMe ? { assignee: "@me" } : {}),
        // Only a deliberate `r` bypasses the daemon cache — a repo switch or a
        // filter toggle should feel instant.
        ...(reloadTick > 0 ? { refresh: true } : {}),
      })
      .then((result) => {
        if (!disposed) setItems(result.items)
      })
      .catch((err: unknown) => {
        if (disposed) return
        // `gh` errors name the fix (not installed / not logged in / no remote);
        // surface them verbatim instead of a generic failure.
        setError(err instanceof Error ? err.message : String(err))
        setItems([])
      })
    return () => {
      disposed = true
    }
  }, [props.orchestrator, repo, assignedToMe, reloadTick])

  const rows = items ?? []
  const [cursor, setCursor] = useState(0)
  useEffect(() => {
    setCursor((c) => clampCursor(c, rows.length))
  }, [rows.length])
  // Two lines per issue against a `limit: 30` fetch — the back half of the
  // list is off-frame from the first keypress.
  const follow = useCursorFollow(cursor)

  // The notice names one action on one issue; a repo switch or a filter
  // toggle makes it stale, and it has no other way to clear.
  // biome-ignore lint/correctness/useExhaustiveDependencies: repo/filter are TRIGGERS — the body clears state rather than reading them.
  useEffect(() => {
    setNotice(null)
  }, [repo, assignedToMe])

  async function startSelected(): Promise<void> {
    const orch = props.orchestrator
    const item = rows[cursor]
    if (!orch || !item || !repo || starting) return
    // Already started: land on that task. The daemon creates unconditionally
    // by contract; this page is the surface that knows what the user sees.
    const linked = linkedTaskFor(orch, repo, item.number)
    if (linked) {
      setNotice(t("workItems.openingLinked", { title: linked.title }))
      props.onOpenTask?.(linked.id)
      return
    }
    setStarting(true)
    setNotice(t("workItems.starting", { number: item.number }))
    try {
      const result = await orch.startWorkItem({ repo, number: item.number })
      if (result.started) props.onOpenTask?.(result.taskId)
      // The task exists even when its engine did not come up — say so rather
      // than leaving the user wondering whether anything happened.
      else setNotice(t("workItems.startedNoEngine", { title: result.title }))
    } catch (err) {
      console.error("[rove work-items] start failed:", err)
      notifyError(t("workItems.startFailed", { number: item.number, error: errorMessage(err) }))
    } finally {
      setStarting(false)
    }
  }

  useBindings(() => ({
    enabled: props.focused !== false,
    bindings: [
      ...pageCloseBindings(props.onClose),
      { key: "j", cmd: () => setCursor((c) => clampCursor(c + 1, rows.length)) },
      { key: "down", cmd: () => setCursor((c) => clampCursor(c + 1, rows.length)) },
      { key: "k", cmd: () => setCursor((c) => clampCursor(c - 1, rows.length)) },
      { key: "up", cmd: () => setCursor((c) => clampCursor(c - 1, rows.length)) },
      { key: "tab", cmd: () => setRepoIndex((i) => (repos.length ? (i + 1) % repos.length : 0)) },
      { key: "a", cmd: () => setAssignedToMe((on) => !on) },
      { key: "r", cmd: () => setReloadTick((tick) => tick + 1) },
      { key: "return", cmd: () => void startSelected() },
    ],
  }))

  const now = Date.now()

  return (
    <box flexDirection="column" flexGrow={1} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {t("workItems.title")}
        </text>
        <text fg={theme.textMuted}>
          {repo ? sidebarProjectLabel(repo, repos) : t("workItems.noRepo")}
          {assignedToMe ? `  ${t("workItems.assignedFilter")}` : ""}
        </text>
      </box>

      {error ? (
        <box flexDirection="column" marginTop={1}>
          <text fg={theme.error}>{error}</text>
          <box marginTop={1}>
            <text fg={theme.textMuted}>{errorHint(error, t)}</text>
          </box>
        </box>
      ) : items === null ? (
        <text fg={theme.textMuted}>{t("common.loading")}</text>
      ) : rows.length === 0 ? (
        <text fg={theme.textMuted}>{t("workItems.empty")}</text>
      ) : (
        <scrollbox
          ref={follow.scrollRef}
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
          marginTop={1}
          verticalScrollbarOptions={{ trackOptions: { foregroundColor: "transparent" } }}
        >
          {rows.map((item, index) => {
            // Sidebar row grammar: ▌ marker column, title line, muted detail
            // line. The number leads the title because that is how an issue is
            // referred to out loud, and it survives truncation there.
            const chrome = resolveRowSelectionChrome(theme, { cursor: index === cursor, selected: false })
            const linked = linkedTaskFor(props.orchestrator, repo, item.number)
            return (
              <box
                key={`${item.number}`}
                ref={follow.rowRef(index)}
                flexDirection="column"
                flexShrink={0}
                {...(chrome.backgroundColor ? { backgroundColor: chrome.backgroundColor } : {})}
              >
                <box flexDirection="row" gap={0}>
                  <text fg={chrome.markerColor} wrapMode="none">
                    {chrome.marker}
                  </text>
                  <box flexDirection="row" flexGrow={1} paddingLeft={1} paddingRight={1} gap={1}>
                    <text fg={theme.textMuted} wrapMode="none">
                      {`#${item.number}`}
                    </text>
                    <text
                      fg={theme.text}
                      attributes={index === cursor ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                      flexGrow={1}
                    >
                      {item.title}
                    </text>
                  </box>
                </box>
                <box flexDirection="row" gap={0}>
                  <text fg={chrome.markerColor} wrapMode="none">
                    {chrome.marker}
                  </text>
                  <box flexDirection="row" flexGrow={1} paddingLeft={2} paddingRight={1} gap={1}>
                    <text fg={theme.textMuted} wrapMode="none" flexGrow={1}>
                      {[item.author, ...item.labels.slice(0, 2)].filter(Boolean).join(" · ")}
                    </text>
                    {linked ? (
                      <text fg={theme.textMuted} wrapMode="none">
                        {t("workItems.linkedChip", { title: linked.title })}
                      </text>
                    ) : null}
                    <text fg={theme.textMuted} wrapMode="none">
                      {relativeAge(item.updatedAt, now)}
                    </text>
                  </box>
                </box>
              </box>
            )
          })}
        </scrollbox>
      )}

      {notice ? (
        <text fg={theme.textMuted} flexShrink={0}>
          {notice}
        </text>
      ) : null}
    </box>
  )
}

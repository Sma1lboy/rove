/** @jsxImportSource @opentui/react */
/**
 * AutomationsPage — the daemon's scheduled automations as a full-page list.
 * Same shape as {@link WorktreesPage}: stale `reloadTick` effect completions
 * are dropped by an effect-local `disposed` flag.
 *
 * `n` composes via {@link AutomationComposer}; on the cursor row `e`
 * pauses/resumes, `s` runs now, `d` deletes, `enter` opens the latest run's
 * task. A routine's engine shows here; changing it, prechecks, grace windows
 * and standing-session mode stay CLI-only (`rove api routine-update`).
 */

import { TextAttributes } from "@opentui/core"
import type { RemoteOrchestrator } from "@sma1lboy/rove-client/client/remote-orchestrator.ts"
import { isNoProjectTask } from "@sma1lboy/rove-client/sidebar/groups.ts"
import {
  buildEventTriggerFromDraft,
  draftTriggerMode,
} from "@sma1lboy/rove-core/automations/automation-composer-core.ts"
import { routineEngineText } from "@sma1lboy/rove-core/automations/automation-engine-core.ts"
import { routineTriggerSubtitle } from "@sma1lboy/rove-core/automations/automation-trigger-core.ts"
import { engineDisplayName } from "@sma1lboy/rove-core/engine/interactive-command.ts"
import { errorMessage } from "@sma1lboy/rove-core/lib/error-message.ts"
import { getSavedRepos } from "@sma1lboy/rove-core/state/repos.ts"
import {
  type Automation,
  type AutomationRun,
  type AutomationRunStatus,
  automationRunNeedsAttention,
} from "@sma1lboy/rove-daemon/daemon/contracts"
import { pathSyntax } from "@sma1lboy/rove-daemon/path-identity"
import { type ReactNode, useEffect, useState } from "react"
import { clampCursor } from "../../tui/component/new-task-dialog/state"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { dividerRule } from "../lib/rule-divider"
import { useCursorFollow } from "../lib/use-cursor-follow"
import { useTerminalSize } from "../lib/use-terminal-size"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { FRAME } from "../ui/frame"
import { AutomationComposer } from "./automation-composer-dialog"
import { AutomationsDetail } from "./automations-detail"
import { formatWhen } from "./automations-format"
import { runGlyph, runToneColor } from "./automations-runs"

/** Agent-driven edits land within a poll; `automation.list` is a local read. */
const POLL_MS = 5_000

function repoLabel(repo: string): string {
  return pathSyntax(repo).basename(repo) || repo
}

export function AutomationsPage(props: {
  orchestrator: RemoteOrchestrator | null
  onClose: () => void
  /** False while another pane holds focus, so bare j/k/d don't fire there. */
  focused?: boolean
  onOpenTask?: (taskId: string) => void
  /** Repo the create flow defaults to (the selected task's project). */
  focusRepo?: string
}): ReactNode {
  const { theme } = useTheme()
  const dialog = useDialog()
  const t = useT()
  const dims = useTerminalSize()
  /**
   * Failures go to the toast queue, not the muted notice line (which reads as
   * a hint); error toasts show even with toasts disabled. Empty taskId/tabId:
   * only the toast queue is consumed.
   */
  const notif = useNotifications()
  function notifyError(message: string): void {
    notif.notify({ kind: "error", taskId: "", tabId: "", title: message })
  }

  const [automations, setAutomations] = useState<readonly Automation[] | null>(null)
  const [keepsDaemonAlive, setKeepsDaemonAlive] = useState(false)
  /** Latest run status per routine id — the list's health column. */
  const [lastRunStatus, setLastRunStatus] = useState<Record<string, AutomationRunStatus>>({})
  const [lastFailure, setLastFailure] = useState<Record<string, { readonly at: string; readonly reason: string }>>({})
  const [runs, setRuns] = useState<readonly AutomationRun[]>([])
  const [reloadTick, setReloadTick] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refetch = (): void => setReloadTick((tick) => tick + 1)
  /** Set only while nothing has loaded: a failed first read, not "no routines". */
  const [loadError, setLoadError] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick is a TRIGGER (the body doesn't read it).
  useEffect(() => {
    let disposed = false
    const orch = props.orchestrator
    if (!orch) {
      setAutomations([])
      return
    }
    const load = (): void => {
      void orch
        .listAutomations()
        .then((result) => {
          if (disposed) return
          setAutomations(result.automations)
          setKeepsDaemonAlive(result.keepsDaemonAlive)
          // Older daemons omit it; empty renders every row as "never run".
          setLastRunStatus(result.lastRunStatus ?? {})
          setLastFailure(result.lastFailure ?? {})
        })
        .catch((err: unknown) => {
          // Keep the previous rows (stale, not wrong) until the next poll succeeds;
          // with none, a failed first load is not an empty routine list.
          if (disposed) return
          setAutomations((prev) => prev ?? [])
          setLoadError((prev) => prev ?? (err instanceof Error ? err.message : String(err)))
        })
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [props.orchestrator, reloadTick])

  const rows = automations ?? []
  const needAttention = rows.filter((a) => {
    const status = lastRunStatus[a.id]
    return status !== undefined && automationRunNeedsAttention(status)
  }).length
  const [cursor, setCursor] = useState(0)
  useEffect(() => {
    setCursor((c) => clampCursor(c, rows.length))
  }, [rows.length])

  const selected = rows[cursor]
  // Three-cell strips: past a dozen, routines are unreachable without this.
  const follow = useCursorFollow(cursor)

  // Run history follows the cursor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick is a TRIGGER (the body doesn't read it).
  useEffect(() => {
    let disposed = false
    const orch = props.orchestrator
    if (!orch || !selected) {
      setRuns([])
      return
    }
    void orch
      .automationRuns(selected.id)
      .then((result) => {
        if (!disposed) setRuns(result.runs)
      })
      .catch(() => {
        if (!disposed) setRuns([])
      })
    return () => {
      disposed = true
    }
  }, [props.orchestrator, selected, reloadTick])

  // A notice names ONE routine; clear it on selection change. Keyed on the id,
  // not `selected` (new object every poll) or `reloadTick` (`runNow` bumps it
  // right after writing the notice).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is a TRIGGER — the body clears state rather than reading it.
  useEffect(() => {
    setNotice(null)
  }, [selected?.id])

  async function toggleEnabled(): Promise<void> {
    const orch = props.orchestrator
    if (!orch || !selected || busyId) return
    setBusyId(selected.id)
    try {
      await orch.setAutomationEnabled(selected.id, !selected.enabled)
      refetch()
    } catch (err) {
      console.error("[rove automations] toggle failed:", err)
      // Unchanged routine: name the state it had BEFORE, not the one requested.
      notifyError(
        t(selected.enabled ? "automations.disableFailed" : "automations.enableFailed", {
          name: selected.name,
          error: errorMessage(err),
        }),
      )
    } finally {
      setBusyId(null)
    }
  }

  async function runNow(): Promise<void> {
    const orch = props.orchestrator
    if (!orch || !selected || busyId) return
    setBusyId(selected.id)
    setNotice(t("automations.running", { name: selected.name }))
    try {
      const result = await orch.runAutomationNow(selected.id)
      setNotice(t("automations.ranWith", { name: selected.name, status: result.status }))
      refetch()
    } catch (err) {
      console.error("[rove automations] run now failed:", err)
      notifyError(t("automations.runFailed", { name: selected.name, error: errorMessage(err) }))
    } finally {
      setBusyId(null)
    }
  }

  /** Create flow: one card, Tab between fields (automation-composer-dialog). */
  async function createAutomation(): Promise<void> {
    const orch = props.orchestrator
    if (!orch || busyId) return
    // Saved projects UNION task repos — the New-task dialog's set
    // (`use-repo-field.ts`); task repos alone hide a just-saved project. No-project
    // tasks run in a synthetic dir, so their repo is not a project.
    const repos = [
      ...new Set([
        ...getSavedRepos(),
        ...orch
          .listTasks()
          .filter((task) => !isNoProjectTask(task))
          .map((task) => task.repo),
      ]),
    ].filter(Boolean)
    const draft = await AutomationComposer.show(dialog, {
      repos,
      tasks: orch.listTasks().filter((task) => !task.deletion),
      ...(props.focusRepo ? { defaultRepo: props.focusRepo } : {}),
    })
    if (!draft) return

    setBusyId("new")
    try {
      const mode = draftTriggerMode(draft)
      const payload = {
        ...(draft.repo === null ? {} : { repo: draft.repo }),
        name: draft.name,
        prompt: draft.prompt,
        ...(mode === "event"
          ? { eventTriggers: [buildEventTriggerFromDraft(draft.eventKind ?? "ci_failed", draft.eventFilter)] }
          : { schedule: draft.schedule }),
        ...(draft.target ? { target: draft.target } : {}),
      }
      await orch.createAutomation(payload)
      refetch()
    } catch (err) {
      // The daemon's cron error names the fix; carry it verbatim.
      console.error("[rove automations] create failed:", err)
      notifyError(t("automations.createFailed", { error: errorMessage(err) }))
    } finally {
      setBusyId(null)
    }
  }

  async function requestDelete(): Promise<void> {
    const orch = props.orchestrator
    if (!orch || !selected || busyId) return
    const ok = await DialogConfirm.show(
      dialog,
      t("automations.deleteTitle"),
      t("automations.deleteBody", { name: selected.name }),
      t("common.cancel"),
      t("automations.deleteButton"),
      { danger: true },
    )
    if (ok !== true) return
    setBusyId(selected.id)
    try {
      await orch.deleteAutomation(selected.id)
      refetch()
    } catch (err) {
      console.error("[rove automations] delete failed:", err)
      notifyError(t("automations.deleteFailed", { name: selected.name, error: errorMessage(err) }))
    } finally {
      setBusyId(null)
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
      { key: "n", cmd: () => void createAutomation() },
      { key: "r", cmd: () => refetch() },
      { key: "e", cmd: () => void toggleEnabled() },
      { key: "s", cmd: () => void runNow() },
      { key: "d", cmd: () => void requestDelete() },
      {
        // `runsFor` is newest-first. Never fall through to an older run's task
        // when the latest made none — that opens a different run than shown.
        key: "return",
        cmd: () => {
          const taskId = runs[0]?.taskId
          if (taskId) props.onOpenTask?.(taskId)
          else if (runs.length > 0) setNotice(t("automations.latestRunNoTask"))
        },
      },
    ],
  }))

  const now = Date.now()
  const engineOf = (automation: Automation) =>
    routineEngineText(automation, engineDisplayName, t("automations.engineDefault"))
  const selectedEngine = selected ? engineOf(selected) : null

  return (
    <box flexDirection="column" flexGrow={1} paddingTop={1} paddingLeft={2} paddingRight={2}>
      {/* Section header in the sidebar's grammar: BOLD CAPS label, a rule
          filling the gap, the daemon-hold state right-stuck. */}
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.text} wrapMode="none" flexShrink={0}>
          {t("automations.title")}
        </text>
        <text fg={theme.borderSubtle} wrapMode="none" flexBasis={0} flexGrow={1} flexShrink={1}>
          {dividerRule(dims.width)}
        </text>
        {/* How many routines are broken, before the daemon-hold state: the
            page's own claim is that these run unattended, so the count of the
            ones that cannot is the first thing worth reading here. */}
        {needAttention > 0 ? (
          <text fg={theme.error} wrapMode="none" flexShrink={0}>
            {t("automations.needAttention", { count: String(needAttention), total: String(rows.length) })}
          </text>
        ) : null}
        <text fg={keepsDaemonAlive ? theme.success : theme.textMuted} wrapMode="none" flexShrink={0}>
          {keepsDaemonAlive ? t("automations.holdingDaemon") : t("automations.notHolding")}
        </text>
      </box>

      {automations === null ? (
        <box paddingTop={1}>
          <text fg={theme.textMuted}>{t("common.loading")}</text>
        </box>
      ) : loadError !== null && automations === null ? (
        <text fg={theme.textMuted}>{t("automations.loadFailed", { message: loadError })}</text>
      ) : rows.length === 0 ? (
        // Empty state points at `n`, not a CLI command.
        <box flexDirection="column" paddingTop={1} gap={1}>
          <text fg={theme.textMuted}>{t("automations.empty")}</text>
          <text fg={theme.text}>{t("automations.emptyHint")}</text>
        </box>
      ) : (
        <scrollbox
          ref={follow.scrollRef}
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
          marginTop={1}
          verticalScrollbarOptions={{ trackOptions: { foregroundColor: "transparent" } }}
        >
          {rows.map((automation, index) => {
            // One boxed strip per automation (border, one content line,
            // border); the frame separates rows instead of a marker column.
            const isCursor = index === cursor
            const lastRun = lastRunStatus[automation.id]
            return (
              <box
                key={automation.id}
                ref={follow.rowRef(index)}
                flexDirection="row"
                flexShrink={0}
                {...FRAME}
                borderColor={isCursor ? theme.borderActive : theme.borderSubtle}
                paddingLeft={1}
                paddingRight={1}
                gap={1}
                {...(isCursor ? { backgroundColor: theme.backgroundElement } : {})}
              >
                <text
                  fg={automation.enabled ? theme.text : theme.textMuted}
                  attributes={isCursor ? TextAttributes.BOLD : undefined}
                  wrapMode="none"
                  flexShrink={1}
                >
                  {automation.name}
                </text>
                {/* A rule between the name and its details: without it the
                    two run together, and the strip has no marker column to
                    separate them the way the sidebar's cards do. */}
                <text fg={theme.borderSubtle} wrapMode="none" flexBasis={0} flexGrow={1} flexShrink={1}>
                  {dividerRule(dims.width)}
                </text>
                <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
                  {[
                    automation.repo ? repoLabel(automation.repo) : t("automations.noProject"),
                    routineTriggerSubtitle(automation),
                    engineOf(automation)?.short,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </text>
                {/* Paused reads as a state, not a missing feature. */}
                {automation.enabled ? null : (
                  <text fg={theme.warning} wrapMode="none" flexShrink={0}>
                    {`${t("automations.paused")} ·`}
                  </text>
                )}
                <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
                  {automation.nextRunAt ? formatWhen(automation.nextRunAt, now) : t("automations.eventModeBadge")}
                </text>
                {/* How the last run went. One cell, right of the next-run
                    time: without it a routine that has failed every firing
                    for an hour is pixel-identical to one that has succeeded
                    every firing, and finding the broken one means arrowing
                    through every row to read the detail box. A routine that
                    has never run gets a blank cell, not a verdict. */}
                <text
                  fg={lastRun ? runToneColor(lastRun, theme) : theme.textMuted}
                  wrapMode="none"
                  flexShrink={0}
                  width={1}
                >
                  {lastRun ? runGlyph(lastRun) : " "}
                </text>
              </box>
            )
          })}
        </scrollbox>
      )}

      <AutomationsDetail
        selected={selected}
        runs={runs}
        busy={Boolean(selected && busyId === selected.id)}
        engineFull={selectedEngine?.full ?? null}
        targetTitle={
          selected?.target
            ? props.orchestrator?.listTasks().find((task) => task.id === selected.target?.taskId)?.title
            : undefined
        }
        lastFailure={selected ? lastFailure[selected.id] : undefined}
        now={now}
        onRunNow={() => void runNow()}
        onOpenTask={props.onOpenTask}
      />

      {notice ? <text fg={theme.textMuted}>{notice}</text> : null}
    </box>
  )
}

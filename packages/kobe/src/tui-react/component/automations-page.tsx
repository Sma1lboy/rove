/** @jsxImportSource @opentui/react */
/**
 * AutomationsPage — the daemon's scheduled automations as a full-page list.
 *
 * Same shape as {@link WorktreesPage}: a standalone full-window surface, the
 * shared close-key contract, `useState` + a `reloadTick`-keyed `useEffect`
 * whose stale completions are dropped by an effect-local `disposed` flag.
 *
 * The page owns the whole routine loop: `n` composes a new one through
 * {@link AutomationComposer} (a repo, a prompt and a cron expression are a
 * form, not a list row), and the cursor row is what `e` pauses/resumes, `s`
 * runs now, `d` deletes and `enter` follows to the latest run's task. What
 * stays on the CLI is the long tail — `rove api routine-update` owns
 * prechecks, grace windows and standing-session mode.
 */

import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import {
  type Automation,
  type AutomationRun,
  type AutomationRunStatus,
  automationRunNeedsAttention,
} from "@sma1lboy/kobe-daemon/daemon/contracts"
import { type ReactNode, useEffect, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { errorMessage } from "../../lib/error-message"
import { getSavedRepos } from "../../state/repos"
import { clampCursor } from "../../tui/component/new-task-dialog/state"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { dividerRule } from "../lib/rule-divider"
import { useCursorFollow } from "../lib/use-cursor-follow"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { FRAME } from "../ui/frame"
import { AutomationComposer } from "./automation-composer-dialog"
import { formatWhen } from "./automations-format"
import { RunHistory, runGlyph, runToneColor } from "./automations-runs"

/** Agent-driven edits land within a poll; `automation.list` is a local read. */
const POLL_MS = 5_000

function repoLabel(repo: string): string {
  return repo.split("/").filter(Boolean).pop() ?? repo
}

export function AutomationsPage(props: {
  orchestrator: RemoteOrchestrator | null
  onClose: () => void
  /** False while another pane holds focus — the page shares the window now,
   *  so its bare j/k/d must not fire while the sidebar is focused. */
  focused?: boolean
  onOpenTask?: (taskId: string) => void
  /** Repo the create flow defaults to (the selected task's project). */
  focusRepo?: string
}): ReactNode {
  const { theme } = useTheme()
  const dialog = useDialog()
  const t = useT()
  const dims = useTerminalDimensions()
  /**
   * Failures go to the toast queue, not the inline notice line — a muted
   * `textMuted` line reads as a hint, not a failure, and error toasts show
   * even when toasts are disabled (shared notify-state invariant). Same
   * empty taskId/tabId pattern as `WorktreesPage`: only the toast queue is
   * consumed here.
   */
  const notif = useNotifications()
  function notifyError(message: string): void {
    notif.notify({ kind: "error", taskId: "", tabId: "", title: message })
  }

  const [automations, setAutomations] = useState<readonly Automation[] | null>(null)
  const [keepsDaemonAlive, setKeepsDaemonAlive] = useState(false)
  /** Latest run status per routine id — the list's health column. */
  const [lastRunStatus, setLastRunStatus] = useState<Record<string, AutomationRunStatus>>({})
  const [runs, setRuns] = useState<readonly AutomationRun[]>([])
  const [reloadTick, setReloadTick] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refetch = (): void => setReloadTick((tick) => tick + 1)

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
          // Absent from a daemon older than this field; an empty map renders
          // every row as "never run", which is the honest reading.
          setLastRunStatus(result.lastRunStatus ?? {})
        })
        .catch(() => {
          // A failed read leaves the previous rows rather than crashing the
          // page. Keeping them IS not calling setState, so there is nothing to
          // do here — the empty array only covers the very first load, which
          // has no rows to keep. The rows go stale rather than wrong: the poll
          // refreshes them the moment the daemon answers again.
          if (!disposed) setAutomations((prev) => prev ?? [])
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
  // Strips are three cells tall, so a dozen of them fill the viewport and
  // every routine past that is unreachable without this.
  const follow = useCursorFollow(cursor)

  // Run history follows the cursor: the list answers "what is scheduled", the
  // history answers "did it actually do anything", and the second question is
  // only ever asked about one automation at a time.
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

  // A notice names ONE routine ("Ran <name>: dispatched"); left standing it
  // reads as the next routine's result. Keyed on the selected ID, not on
  // `selected` (a new object every poll) and not on `reloadTick` (which
  // `runNow` bumps immediately after writing the notice).
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
      // The routine is unchanged, so the surviving state is the one it had
      // BEFORE the click — name that, not the state the user asked for.
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
    // Saved projects UNION the repos tasks happen to sit in — the same set the
    // New-task dialog offers (`use-repo-field.ts`) and the "scrolling picker
    // over your projects" `docs/ROUTINES.md` promises. Task repos alone hid a
    // project you had saved but never opened a task in, so the one repo you
    // could not schedule was the one you had just added.
    const repos = [...new Set([...getSavedRepos(), ...orch.listTasks().map((task) => task.repo)])].filter(Boolean)
    if (repos.length === 0) {
      setNotice(t("automations.needRepo"))
      return
    }
    const draft = await AutomationComposer.show(dialog, {
      repos,
      tasks: orch.listTasks().filter((task) => !task.deletion),
      ...(props.focusRepo ? { defaultRepo: props.focusRepo } : {}),
    })
    if (!draft) return

    setBusyId("new")
    try {
      await orch.createAutomation(draft)
      refetch()
    } catch (err) {
      // The daemon re-validates the cron and its message names the fix, so it
      // is carried verbatim after the action this toast failed at.
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
        // `runsFor` is newest-first, so runs[0] IS the latest run. Falling
        // through to an older run's task when the latest made none (a healthy
        // `skipped_precheck`) opens a DIFFERENT run than the one on screen.
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
      ) : rows.length === 0 ? (
        // Empty state points at the key that fixes it, not at a CLI command:
        // `n` is right there, and the command line is a fallback.
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
            // One boxed strip per automation, three cells tall: border, one
            // content line, border. Everything about a schedule fits on that
            // line — name, where it runs, when it next fires — so a second
            // line would be padding, and the frame is what separates rows
            // instead of a marker column.
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
                  {`${repoLabel(automation.repo)} · ${automation.schedule}`}
                </text>
                {/* Paused reads as a state, not a missing feature. */}
                {automation.enabled ? null : (
                  <text fg={theme.warning} wrapMode="none" flexShrink={0}>
                    {`${t("automations.paused")} ·`}
                  </text>
                )}
                <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
                  {formatWhen(automation.nextRunAt, now)}
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

      {/* The detail frame is always mounted, even with nothing selected: a
          panel that appears and disappears makes the page jump, and the empty
          frame is where a first-time user reads what a routine even carries. */}
      <box flexDirection="column" marginTop={1} {...FRAME} borderColor={theme.border} padding={1} flexShrink={0}>
        {selected ? (
          <>
            <box flexDirection="row" justifyContent="space-between" gap={2}>
              <text fg={theme.text} wrapMode="none" flexShrink={1} flexGrow={1}>
                {selected.prompt}
              </text>
              {/* Running one on demand is how you find out a routine works
                  without waiting for its schedule — the reason it is a button
                  and not only the `s` key. */}
              <text
                fg={busyId === selected.id ? theme.textMuted : theme.primary}
                attributes={TextAttributes.BOLD}
                wrapMode="none"
                flexShrink={0}
                onMouseUp={() => void runNow()}
              >
                {t("automations.runNow")}
              </text>
            </box>
            <text fg={theme.textMuted} wrapMode="word">
              {selected.target
                ? t("automations.targetExisting", {
                    task:
                      props.orchestrator?.listTasks().find((task) => task.id === selected.target?.taskId)?.title ??
                      selected.target.taskId,
                    tab: selected.target.tabId,
                  })
                : t(selected.persistentSession ? "automations.targetStanding" : "automations.targetFresh")}
            </text>
            {selected.precheck ? (
              <text fg={theme.textMuted}>{t("automations.precheck", { command: selected.precheck.command })}</text>
            ) : null}
            <RunHistory runs={runs} now={now} />
          </>
        ) : (
          <text fg={theme.textMuted}>{t("automations.noSelection")}</text>
        )}
      </box>

      {notice ? <text fg={theme.textMuted}>{notice}</text> : null}
    </box>
  )
}

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
import type { Automation, AutomationRun } from "@sma1lboy/kobe-daemon/daemon/contracts"
import { type ReactNode, useEffect, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { errorMessage } from "../../lib/error-message"
import { relativeBuckets } from "../../lib/relative-time"
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

/** Agent-driven edits land within a poll; `automation.list` is a local read. */
const POLL_MS = 5_000

/** Run-status → how it should read at a glance. The four "didn't run" reasons
 *  are deliberately distinct: `skipped_precheck` is healthy (nothing to do),
 *  `dispatch_failed` wants a human. Collapsing them would hide that. */
const RUN_TONE: Record<string, "success" | "muted" | "warning" | "error"> = {
  dispatched: "success",
  // Delivered, so not grey: `revived` reached a respawned session (the status
  // text carries the lost-context caveat), `deferred` reached the Inbox and is
  // warning rather than success because it is parked until a human releases it.
  revived: "success",
  deferred: "warning",
  skipped_precheck: "muted",
  skipped_missed: "warning",
  skipped_unavailable: "warning",
  dispatch_failed: "error",
}

function formatWhen(iso: string | undefined, now: number): string {
  if (!iso) return "—"
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return "—"
  const deltaMs = at - now
  const { minutes, hours } = relativeBuckets(Math.abs(deltaMs))
  if (minutes < 1) return deltaMs >= 0 ? "now" : "just now"
  if (minutes < 60) return deltaMs >= 0 ? `in ${minutes}m` : `${minutes}m ago`
  if (hours < 24) return deltaMs >= 0 ? `in ${hours}h` : `${hours}h ago`
  return new Date(at).toLocaleDateString()
}

function repoLabel(repo: string): string {
  return repo.split("/").filter(Boolean).pop() ?? repo
}

/** `·` cron fired it, `▸` a human did. One cell, and it answers "did I run
 *  this or did the schedule" without opening anything. Both glyphs are
 *  already in the sidebar's vocabulary, so no new font coverage is at stake. */
function triggerGlyph(trigger: AutomationRun["trigger"]): string {
  return trigger === "manual" ? "▸" : "·"
}

/** The last ~10 lines of a captured stream, trimmed of trailing blanks.
 *  Truncation happens HERE and not at capture time: the runner already stores
 *  what it stores, and a detail view that shrank the record would make the
 *  next reader's question unanswerable. */
function outputTail(text: string, limit = 10): string[] {
  const lines = text.replace(/\s+$/, "").split("\n")
  return lines.length > limit ? lines.slice(-limit) : lines
}

/**
 * Why the latest run did not run: the precheck's exit code, how long it took,
 * and the output it actually produced.
 *
 * The runner has always captured `stdout`, `stderr`, `exitCode` and
 * `durationMs` on a `skipped_precheck` run and stored them on the record; the
 * page collapsed all four to `precheck exited 1`, which leaves reconstructing
 * the command by hand as the only way to find out what it said — the exact
 * debugging step Rove already did and then discarded.
 *
 * Scoped to the MOST RECENT run on purpose. That is the one that explains the
 * state the page is showing; an older skip is history, and reading it here
 * would answer a question about a routine that has since run fine. Showing it
 * unconditionally is also what keeps this off the keymap: a per-run cursor
 * needs a chord, and a chord needs the owner.
 *
 * An empty stream is omitted rather than printed as a blank label — a
 * precheck that wrote nothing to stderr should not look like one whose stderr
 * failed to load.
 */
function PrecheckDetail(props: { run: AutomationRun | undefined }): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const result = props.run?.precheckResult
  if (!result) return null
  const exit = result.timedOut
    ? t("automations.precheckTimedOut")
    : t("automations.precheckExited", { code: String(result.exitCode ?? "?") })
  const streams = [
    { label: t("automations.precheckStdout"), text: result.stdout },
    { label: t("automations.precheckStderr"), text: result.stderr },
  ].filter((stream) => stream.text.trim().length > 0)
  return (
    <box flexDirection="column" marginTop={1} flexShrink={0}>
      <text attributes={TextAttributes.BOLD} fg={theme.textMuted}>
        {t("automations.precheckDetail", { exit, duration: String(result.durationMs) })}
      </text>
      {streams.length === 0 ? (
        <text fg={theme.textMuted}>{t("automations.precheckNoOutput")}</text>
      ) : (
        streams.map((stream) => (
          <box key={stream.label} flexDirection="row" gap={1}>
            <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
              {`${stream.label}:`}
            </text>
            <text fg={theme.text} flexShrink={1}>
              {outputTail(stream.text).join("\n")}
            </text>
          </box>
        ))
      )}
    </box>
  )
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
      notifyError(t("automations.failed", { error: errorMessage(err) }))
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
      notifyError(t("automations.failed", { error: errorMessage(err) }))
    } finally {
      setBusyId(null)
    }
  }

  /** Create flow: one card, Tab between fields (automation-composer-dialog). */
  async function createAutomation(): Promise<void> {
    const orch = props.orchestrator
    if (!orch || busyId) return
    const repos = [...new Set(orch.listTasks().map((task) => task.repo))].filter(Boolean)
    if (repos.length === 0) {
      setNotice(t("automations.needRepo"))
      return
    }
    const draft = await AutomationComposer.show(dialog, {
      repos,
      ...(props.focusRepo ? { defaultRepo: props.focusRepo } : {}),
    })
    if (!draft) return

    setBusyId("new")
    try {
      await orch.createAutomation(draft)
      refetch()
    } catch (err) {
      // The daemon re-validates the cron; its message names the fix, so it
      // leads the error toast.
      console.error("[rove automations] create failed:", err)
      notifyError(t("automations.failed", { error: errorMessage(err) }))
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
      notifyError(t("automations.failed", { error: errorMessage(err) }))
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
            {selected.precheck ? (
              <text fg={theme.textMuted}>{t("automations.precheck", { command: selected.precheck.command })}</text>
            ) : null}
            <text attributes={TextAttributes.BOLD} fg={theme.text}>
              {t("automations.recentRuns")}
            </text>
            {runs.length === 0 ? (
              <text fg={theme.textMuted}>{t("automations.noRuns")}</text>
            ) : (
              runs.slice(0, 5).map((run) => {
                const tone = RUN_TONE[run.status] ?? "muted"
                const color =
                  tone === "success"
                    ? theme.success
                    : tone === "warning"
                      ? theme.warning
                      : tone === "error"
                        ? theme.error
                        : theme.textMuted
                return (
                  <text key={run.id} fg={color}>
                    {`${triggerGlyph(run.trigger)} #${run.runNumber} ${run.status}${run.error ? ` — ${run.error}` : ""}  ${formatWhen(run.at, now)}`}
                  </text>
                )
              })
            )}
            <PrecheckDetail run={runs[0]} />
          </>
        ) : (
          <text fg={theme.textMuted}>{t("automations.noSelection")}</text>
        )}
      </box>

      {notice ? <text fg={theme.textMuted}>{notice}</text> : null}
    </box>
  )
}

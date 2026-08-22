/** @jsxImportSource @opentui/react */
/**
 * AgentTreePage — durable collaboration provenance as an operator surface.
 *
 * The page does not infer relationships from transcript copy. Parent edges
 * come from Task.dispatcher.taskId and fan-out rounds from Task.groupId; live
 * activity remains the engine-normalized TaskEngineState already carried by
 * the orchestrator snapshot.
 */

import { type BoxRenderable, type ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { TaskEngineState } from "../../client/remote-orchestrator"
import { engineEntry } from "../../engine/registry"
import type { Theme } from "../../tui/context/theme-core"
import { type AgentTreeRow, agentTreePrefix, buildAgentTree, shortGroupId } from "../../tui/multiagent/tree-core"
import { sidebarProjectLabel } from "../../tui/panes/sidebar/groups"
import { DEFAULT_TASK_VENDOR, type Task } from "../../types/task"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { resolveRowSelectionChrome } from "../ui/row-selection-chrome"

type Tone = "primary" | "success" | "warning" | "error" | "muted"

function activityView(task: Task, activity: TaskEngineState | undefined): { glyph: string; key: string; tone: Tone } {
  if (task.archived) return { glyph: "·", key: "agents.state.archived", tone: "muted" }
  switch (activity?.state) {
    case "running":
      return { glyph: "◐", key: "agents.state.running", tone: "primary" }
    case "turn_complete":
      return { glyph: "●", key: "agents.state.complete", tone: "success" }
    case "permission_needed":
      return { glyph: "?", key: "agents.state.permission", tone: "warning" }
    case "rate_limited":
      return { glyph: "◷", key: "agents.state.rateLimited", tone: "warning" }
    case "error":
      return { glyph: "×", key: "agents.state.error", tone: "error" }
    default:
      return { glyph: "○", key: "agents.state.idle", tone: "muted" }
  }
}

function toneColor(theme: Theme, tone: Tone): Theme["primary"] {
  switch (tone) {
    case "primary":
      return theme.primary
    case "success":
      return theme.success
    case "warning":
      return theme.warning
    case "error":
      return theme.error
    default:
      return theme.textMuted
  }
}

function reposOf(tasks: readonly Task[]): string[] {
  const repos: string[] = []
  for (const task of tasks) {
    if (task.repo && !repos.includes(task.repo)) repos.push(task.repo)
  }
  return repos
}

export function AgentTreePage(props: {
  tasks: readonly Task[]
  engineStates?: ReadonlyMap<string, TaskEngineState>
  selectedTask?: Task
  focused?: boolean
  onClose: () => void
  onOpenTask?: (taskId: string) => void
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const repos = reposOf(props.tasks)
  const [repoIndex, setRepoIndex] = useState(() => {
    const wanted = props.selectedTask ? repos.indexOf(props.selectedTask.repo) : -1
    return wanted >= 0 ? wanted : 0
  })
  const repo = repos[repoIndex]
  const tasks = repo ? props.tasks.filter((task) => task.repo === repo) : []
  const projection = buildAgentTree(tasks)
  const taskRows = projection.rows.filter((row) => row.kind === "task")
  const [cursor, setCursor] = useState(() => {
    const wanted = props.selectedTask ? taskRows.findIndex((row) => row.task.id === props.selectedTask?.id) : -1
    return wanted >= 0 ? wanted : 0
  })

  useEffect(() => {
    setCursor((value) => Math.max(0, Math.min(value, taskRows.length - 1)))
  }, [taskRows.length])

  const selectedId = taskRows[cursor]?.task.id
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const rowRefs = useRef(new Map<string, BoxRenderable>())
  useEffect(() => {
    const scroll = scrollRef.current
    const row = selectedId ? rowRefs.current.get(selectedId) : undefined
    if (scroll && row && scroll.viewport.height > 0) scroll.scrollChildIntoView(row.id)
  }, [selectedId])

  function moveCursor(delta: -1 | 1): void {
    setCursor((value) => Math.max(0, Math.min(value + delta, taskRows.length - 1)))
  }

  function cycleRepo(delta: -1 | 1): void {
    if (repos.length === 0) return
    setRepoIndex((value) => (value + delta + repos.length) % repos.length)
    setCursor(0)
  }

  useBindings(() => ({
    enabled: props.focused !== false,
    bindings: [
      ...pageCloseBindings(props.onClose),
      { key: "j", cmd: () => moveCursor(1) },
      { key: "down", cmd: () => moveCursor(1) },
      { key: "k", cmd: () => moveCursor(-1) },
      { key: "up", cmd: () => moveCursor(-1) },
      { key: "tab", cmd: () => cycleRepo(1) },
      { key: "shift+tab", cmd: () => cycleRepo(-1) },
      { key: "return", cmd: () => selectedId && props.onOpenTask?.(selectedId) },
    ],
  }))

  function roundRow(row: Extract<AgentTreeRow, { kind: "round" }>): ReactNode {
    const active = row.tasks.filter((task) => props.engineStates?.get(task.id)?.state === "running").length
    return (
      <box key={row.id} flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
        <text fg={theme.borderActive} wrapMode="none">
          {agentTreePrefix(row)}
        </text>
        <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
          ◇ {t("agents.round", { id: shortGroupId(row.groupId) })}
        </text>
        <text fg={theme.textMuted} wrapMode="none" flexGrow={1}>
          {" "}
          {t("agents.roundMeta", { count: row.tasks.length, active })}
        </text>
      </box>
    )
  }

  function taskRow(row: Extract<AgentTreeRow, { kind: "task" }>, taskIndex: number): ReactNode {
    const selected = taskIndex === cursor
    const chrome = resolveRowSelectionChrome(theme, { cursor: selected, selected: false })
    const activity = activityView(row.task, props.engineStates?.get(row.task.id))
    const roleKey = row.anomaly ? `agents.${row.anomaly}` : `agents.${row.role}`
    const engine = engineEntry(row.task.vendor ?? DEFAULT_TASK_VENDOR)
    return (
      <box
        key={row.id}
        ref={(renderable: BoxRenderable | null) => {
          if (renderable) rowRefs.current.set(row.task.id, renderable)
          else rowRefs.current.delete(row.task.id)
        }}
        flexDirection="row"
        flexShrink={0}
        paddingRight={1}
        backgroundColor={chrome.backgroundColor}
        onMouseUp={() => setCursor(taskIndex)}
      >
        <text fg={chrome.markerColor} wrapMode="none">
          {chrome.marker}
        </text>
        <text fg={theme.borderActive} wrapMode="none">
          {agentTreePrefix(row)}
        </text>
        <text fg={toneColor(theme, activity.tone)} wrapMode="none">
          {activity.glyph}
        </text>
        <text
          fg={theme.text}
          attributes={selected ? TextAttributes.BOLD : undefined}
          wrapMode="none"
          flexBasis={0}
          flexGrow={1}
          paddingLeft={1}
        >
          {row.task.title}
        </text>
        <text fg={row.anomaly ? theme.warning : theme.textMuted} wrapMode="none" paddingLeft={1}>
          {t(roleKey)}
        </text>
        <text fg={theme.textMuted} wrapMode="none" paddingLeft={1}>
          {engine.identity?.shortName ?? engine.displayName}
        </text>
        <text fg={toneColor(theme, activity.tone)} wrapMode="none" paddingLeft={1}>
          {t(activity.key)}
        </text>
      </box>
    )
  }

  let taskIndex = -1
  const anomalySuffix =
    projection.summary.anomalies > 0 ? t("agents.summaryAnomalies", { count: projection.summary.anomalies }) : ""

  return (
    <box flexDirection="column" flexGrow={1} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
      <box flexDirection="row" flexShrink={0} gap={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.primary} wrapMode="none">
          {t("agents.title")}
        </text>
        <text fg={theme.borderSubtle} wrapMode="none" flexBasis={0} flexGrow={1}>
          {"─".repeat(240)}
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          {repo ? sidebarProjectLabel(repo, repos) : t("agents.noRepo")}
          {repos.length > 1 ? ` ${repoIndex + 1}/${repos.length}` : ""}
        </text>
      </box>

      {repo ? (
        <text fg={projection.summary.anomalies > 0 ? theme.warning : theme.textMuted} wrapMode="none" flexShrink={0}>
          {t("agents.summary", {
            owners: projection.summary.owners,
            agents: projection.summary.agents,
            rounds: projection.summary.rounds,
          })}
          {anomalySuffix}
        </text>
      ) : null}

      {!repo ? (
        <text fg={theme.textMuted} paddingTop={1}>
          {t("agents.noRepo")}
        </text>
      ) : projection.rows.length === 0 ? (
        <text fg={theme.textMuted} paddingTop={1}>
          {t("agents.empty")}
        </text>
      ) : (
        <scrollbox
          ref={(renderable: ScrollBoxRenderable | null) => {
            scrollRef.current = renderable
          }}
          flexGrow={1}
          minHeight={0}
          paddingTop={1}
          stickyScroll={false}
          verticalScrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column" flexShrink={0}>
            {projection.rows.map((row) => {
              if (row.kind === "round") return roundRow(row)
              taskIndex += 1
              return taskRow(row, taskIndex)
            })}
          </box>
        </scrollbox>
      )}

      <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none" flexShrink={0}>
        {t("agents.hint")}
      </text>
    </box>
  )
}

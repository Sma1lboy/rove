/** @jsxImportSource @opentui/react */
/**
 * AgentTreePage — compatibility filename for the Agent Topology surface.
 * Dagre lays out durable dispatcher edges; batch outlines come from groupId.
 */

import { TextAttributes } from "@opentui/core"
import { type ReactNode, useEffect, useState } from "react"
import type { TaskEngineState } from "../../client/remote-orchestrator"
import { buildAgentTopology, topologyRootId } from "../../tui/multiagent/tree-core"
import { sidebarProjectLabel } from "../../tui/panes/sidebar/groups"
import type { Task } from "../../types/task"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { AgentTopologyCanvas } from "./agent-topology-canvas"

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
  const projection = buildAgentTopology(tasks)
  const [cursor, setCursor] = useState(() => {
    const wanted = props.selectedTask ? projection.nodes.findIndex((node) => node.id === props.selectedTask?.id) : -1
    return wanted >= 0 ? wanted : 0
  })

  useEffect(() => {
    setCursor((value) => Math.max(0, Math.min(value, projection.nodes.length - 1)))
  }, [projection.nodes.length])

  const selectedId = projection.nodes[cursor]?.id
  const rootIds = projection.nodes.filter((node) => node.role === "root").map((node) => node.id)
  const selectedRootId = topologyRootId(projection, selectedId)
  const selectedRootIndex = Math.max(0, rootIds.indexOf(selectedRootId ?? ""))

  function moveCursor(delta: -1 | 1): void {
    setCursor((value) => Math.max(0, Math.min(value + delta, projection.nodes.length - 1)))
  }

  function cycleRepo(delta: -1 | 1): void {
    if (repos.length === 0) return
    setRepoIndex((value) => (value + delta + repos.length) % repos.length)
    setCursor(0)
  }

  function cycleRoot(delta: -1 | 1): void {
    if (rootIds.length === 0) return
    const nextRootId = rootIds[(selectedRootIndex + delta + rootIds.length) % rootIds.length]
    const nextCursor = projection.nodes.findIndex((node) => node.id === nextRootId)
    if (nextCursor >= 0) setCursor(nextCursor)
  }

  useBindings(() => ({
    enabled: props.focused !== false,
    bindings: [
      ...pageCloseBindings(props.onClose),
      { key: "j", cmd: () => moveCursor(1) },
      { key: "down", cmd: () => moveCursor(1) },
      { key: "k", cmd: () => moveCursor(-1) },
      { key: "up", cmd: () => moveCursor(-1) },
      { key: "left", cmd: () => cycleRoot(-1) },
      { key: "right", cmd: () => cycleRoot(1) },
      { key: "tab", cmd: () => cycleRepo(1) },
      { key: "shift+tab", cmd: () => cycleRepo(-1) },
      { key: "return", cmd: () => selectedId && props.onOpenTask?.(selectedId) },
    ],
  }))
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
        <box flexDirection="row" flexShrink={0} gap={2}>
          <text
            fg={projection.summary.anomalies > 0 ? theme.warning : theme.textMuted}
            wrapMode="none"
            flexBasis={0}
            flexGrow={1}
          >
            {t("agents.summary", {
              agents: projection.summary.agents,
              coordinators: projection.summary.coordinators,
              batches: projection.summary.batches,
            })}
            {anomalySuffix}
          </text>
          <text fg={theme.borderActive} wrapMode="none">
            {t("agents.legend")}
          </text>
          <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="none">
            {t("agents.rootNav", { current: rootIds.length > 0 ? selectedRootIndex + 1 : 0, count: rootIds.length })}
          </text>
        </box>
      ) : null}

      {!repo ? (
        <text fg={theme.textMuted} paddingTop={1}>
          {t("agents.noRepo")}
        </text>
      ) : projection.nodes.length === 0 ? (
        <text fg={theme.textMuted} paddingTop={1}>
          {t("agents.empty")}
        </text>
      ) : (
        <AgentTopologyCanvas
          projection={projection}
          selectedId={selectedId}
          engineStates={props.engineStates}
          onSelect={(taskId) => {
            const index = projection.nodes.findIndex((node) => node.id === taskId)
            if (index >= 0) setCursor(index)
          }}
        />
      )}

      <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none" flexShrink={0}>
        {t("agents.hint")}
      </text>
    </box>
  )
}

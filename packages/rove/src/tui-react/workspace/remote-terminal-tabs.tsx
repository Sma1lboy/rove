/**
 * The workspace for a task on another registered machine. Its tabs, their KV and its engines live
 * over there, so nothing here goes through `TerminalTabs` (local KV, local spawn, local turn
 * polls). The tab list is that machine's `get-task`, polled; each tab's terminal attaches that
 * machine's PTY host over the forwarded socket (`Terminal machine=…`, attach only); new and
 * closed tabs are that machine's `tab-new` / `tab-close`.
 */

import { useEffect, useState } from "react"
import type { TaskTabRow } from "../../cli/api/tab-snapshot.ts"
import { forwardVerb, requireMachine } from "../../machines/forward.ts"
import { prefixAction } from "../../tui/lib/keymap-dispatch"
import { bindByIds } from "../context/keybindings"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { Terminal } from "../panes/terminal/Terminal"

/** Tabs change on the other machine's clock; a couple of seconds is what the sidebar's host poll uses. */
const POLL_MS = 2000

async function verbOn<T>(machine: string, verb: string, params: Record<string, string>): Promise<T> {
  const envelope = await forwardVerb(requireMachine(machine), verb, params)
  if (!envelope.ok) throw new Error(envelope.error.message)
  return envelope.result as T
}

/** The PTY session key a tab row attaches: a viewport tab shows another task's first engine. */
function sessionKey(taskId: string, tab: TaskTabRow & { viewOf?: string }): string {
  return tab.viewOf ? `${tab.viewOf}::tab-1` : `${taskId}::${tab.id}`
}

function tabLabel(tab: TaskTabRow): string {
  return tab.title ?? tab.autoTitle ?? tab.lastTitle ?? tab.liveVendor ?? tab.vendor ?? tab.id
}

export function RemoteTerminalTabs(props: {
  readonly taskId: string
  readonly machine: string
  readonly host: string
  readonly worktree: string
  readonly focused: boolean
}) {
  const { theme } = useTheme()
  const t = useT()
  const [tabs, setTabs] = useState<readonly TaskTabRow[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a refetch trigger
  useEffect(() => {
    let live = true
    const load = () =>
      verbOn<{ tabs?: TaskTabRow[] }>(props.machine, "get-task", { "task-id": props.taskId }).then(
        (res) => {
          if (!live) return
          const rows = (res.tabs ?? []).filter((tab) => tab.kind !== "content")
          setTabs(rows)
          setError(null)
          setActiveId((cur) => (cur && rows.some((tab) => tab.id === cur) ? cur : (rows[0]?.id ?? null)))
        },
        (err: unknown) => live && setError(err instanceof Error ? err.message : String(err)),
      )
    void load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [props.machine, props.taskId, tick])

  const refresh = () => setTick((n) => n + 1)
  const list = tabs ?? []
  const index = Math.max(
    0,
    list.findIndex((tab) => tab.id === activeId),
  )
  const active = list[index] ?? null
  const step = (dir: 1 | -1) => {
    if (list.length === 0) return
    setActiveId(list[(index + dir + list.length) % list.length]?.id ?? null)
  }
  const run = (verb: string, params: Record<string, string>) =>
    void verbOn<{ tabId?: string }>(props.machine, verb, { "task-id": props.taskId, ...params })
      .then((res) => {
        if (res?.tabId) setActiveId(res.tabId)
        refresh()
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))

  useBindings(() => ({
    enabled: props.focused,
    bindings: bindByIds({
      "chat.tab.new": prefixAction(() => run("tab-new", { kind: "engine" })),
      "chat.tab.cycle-next": prefixAction(() => step(1)),
      "chat.tab.cycle-prev": prefixAction(() => step(-1)),
      "chat.tab.goto": (_evt, slot) => setActiveId(list[slot ?? 0]?.id ?? activeId),
      "chat.tab.close": prefixAction(() => active && run("tab-close", { tab: active.id })),
    }),
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={2} paddingLeft={1} flexShrink={0}>
        <text fg={theme.textMuted}>{t("tasks.machine.runsOn", { host: props.host })}</text>
        {list.map((tab, i) => (
          <text key={tab.id} fg={tab.id === active?.id ? theme.focusAccent : theme.textMuted}>
            {`${i + 1} ${tabLabel(tab)}${tab.alive === false ? " ✕" : ""}`}
          </text>
        ))}
      </box>
      {error ? (
        <text fg={theme.textMuted} paddingLeft={1}>
          {error}
        </text>
      ) : null}
      {tabs === null ? (
        <text fg={theme.textMuted} paddingLeft={1}>
          {t("terminal.restoring")}
        </text>
      ) : active ? (
        <Terminal
          key={sessionKey(props.taskId, active)}
          taskId={sessionKey(props.taskId, active)}
          machine={props.machine}
          cwd={props.worktree}
          command={[]}
          focused={props.focused}
        />
      ) : (
        <text fg={theme.textMuted} paddingLeft={1}>
          {t("tasks.machine.noTabs", { host: props.host })}
        </text>
      )}
    </box>
  )
}

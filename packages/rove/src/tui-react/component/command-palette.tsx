/** @jsxImportSource @opentui/react */
import { flushSync } from "@opentui/react"
import { useState } from "react"
import { relativeAge } from "../../lib/relative-time"
import { formatChord } from "../../tui/lib/chord-glyphs"
import { matchesHelpAction } from "../../tui/lib/help-groups"
import { currentPrefixConfiguration } from "../../tui/lib/keymap-dispatch"
import type { PaletteAction } from "../../tui/lib/palette-actions"
import { useTheme } from "../context/theme"
import { tKeys, useT } from "../i18n"
import { currentPaletteActions, useBindings } from "../lib/keymap"
import { useTerminalSize } from "../lib/use-terminal-size"
import { type DialogContext, useDialog, useDialogPaddingX } from "../ui/dialog"
import { type PaletteSearch, splitMarked, useMatchingTasks, useSaid } from "./palette-search"

type Entry =
  | {
      readonly kind: "command"
      readonly key: string
      readonly name: string
      readonly chord: string
      readonly action: PaletteAction
    }
  | { readonly kind: "task"; readonly key: string; readonly name: string; readonly taskId: string }
  | {
      readonly kind: "said"
      readonly key: string
      readonly name: string
      readonly taskId: string
      readonly tabId?: string
      readonly role: "user" | "assistant"
      readonly at: string
      readonly snippet: string
    }

/** A palette entry with no keybinding: the F1 guide and chord table never list it. */
export type PaletteExtra = { readonly id: string; readonly name: string; readonly run: () => void }

export function CommandPalette({
  actions,
  search,
  extras = [],
}: { actions: readonly PaletteAction[]; search?: PaletteSearch; extras?: readonly PaletteExtra[] }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const t = useT()
  const padX = useDialogPaddingX()
  const dimensions = useTerminalSize()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState(0)
  const prefix = currentPrefixConfiguration().key
  const commands: Entry[] = [
    ...actions.map((action) => ({
      kind: "command" as const,
      key: `c:${action.id}`,
      action,
      name: tKeys("desc", action.id),
      chord: action.prefix
        ? `${prefix ? formatChord(prefix) : ""} + ${formatChord(action.key)}`
        : formatChord(action.key),
    })),
    ...extras.map((extra) => ({
      kind: "command" as const,
      key: `x:${extra.id}`,
      action: {
        id: extra.id,
        key: "",
        prefix: false,
        run: () => {
          extra.run()
          return true
        },
      },
      name: extra.name,
      chord: "",
    })),
  ].filter((row) =>
    matchesHelpAction(query, row.name, row.action.prefix ? `${prefix} + ${row.action.key}` : row.action.key),
  )
  const tasks: Entry[] = useMatchingTasks(search, query).map((task) => ({
    kind: "task",
    key: `t:${task.id}`,
    name: task.archived ? t("tasks.archivedHit", { title: task.title }) : task.title,
    taskId: task.id,
  }))
  const said = useSaid(search, query)
  const hits: Entry[] =
    said.kind === "done"
      ? said.result.matches.map((hit, i) => ({
          kind: "said",
          key: `s:${hit.taskId}:${hit.at}:${i}`,
          name: hit.title,
          taskId: hit.taskId,
          ...(hit.tabId ? { tabId: hit.tabId } : {}),
          role: hit.role,
          at: hit.at,
          snippet: hit.snippet,
        }))
      : []
  const rows = [...commands, ...tasks, ...hits]
  const extra = tasks.length > 0 || said.kind !== "idle"
  // Heads, notes and two-line hits take room the plain command list does not.
  const visibleCount = Math.max(1, Math.min(10, dimensions.height - 10 - (extra ? 6 : 0)))
  const index = Math.min(selected, Math.max(0, rows.length - 1))
  const run = (row: Entry) => {
    flushSync(() => dialog.clear({ refocus: false }))
    if (row.kind === "command") {
      if (!row.action.run()) dialog.replace(() => <text fg={theme.warning}>{t("help.unavailable")}</text>)
    } else {
      // The sidebar does not list archived tasks: picking one here brings it back, then opens it.
      const task = row.kind === "task" ? search?.tasks.find((candidate) => candidate.id === row.taskId) : undefined
      if (task?.archived) void search?.orchestrator.archiveTask(task.id, false)
      search?.openTask(row.taskId, row.kind === "said" ? row.tabId : undefined)
    }
  }
  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => setSelected(Math.max(0, index - 1)) },
      { key: "down", cmd: () => setSelected(Math.min(rows.length - 1, index + 1)) },
      {
        key: "return",
        cmd: () => {
          const row = rows[index]
          if (row) run(row)
        },
      },
    ],
  }))
  const start = Math.max(0, index - visibleCount + 1)
  const now = Date.now()
  const head = (at: number, row: Entry) => {
    if (!extra || (at > 0 && rows[at - 1]?.kind === row.kind)) return null
    const label = { command: "search.commands", task: "search.tasks", said: "search.inConversations" } as const
    return <text fg={theme.textMuted}>{t(label[row.kind])}</text>
  }
  return (
    <box paddingLeft={padX} paddingRight={padX} paddingBottom={1} gap={1}>
      <text fg={theme.accent}>{t("help.palette")}</text>
      <input
        focused
        value={query}
        placeholder={t("help.search")}
        onInput={(value: string) => {
          setQuery(value)
          setSelected(0)
        }}
      />
      <box>
        {rows.length === 0 && said.kind === "idle" ? (
          <text fg={theme.textMuted}>{t("help.noResults")}</text>
        ) : (
          rows.slice(start, start + visibleCount).map((row, offset) => {
            const at = start + offset
            const picked = at === index
            return (
              <box key={row.key} flexDirection="column">
                {head(at, row)}
                <box
                  flexDirection="column"
                  backgroundColor={picked ? theme.backgroundElement : undefined}
                  onMouseUp={() => run(row)}
                >
                  <box flexDirection="row" gap={2}>
                    <text
                      fg={theme.text}
                      flexGrow={1}
                      flexBasis={0}
                      flexShrink={1}
                    >{`${picked ? "› " : "  "}${row.name}`}</text>
                    {row.kind === "command" && (
                      <text fg={theme.primary} flexShrink={0}>
                        {row.chord}
                      </text>
                    )}
                    {row.kind === "said" && (
                      <text fg={theme.textMuted} flexShrink={0}>
                        {`${t(row.role === "user" ? "search.you" : "search.agent")} · ${relativeAge(Date.parse(row.at), now)}`}
                      </text>
                    )}
                  </box>
                  {row.kind === "said" && (
                    <text fg={theme.textMuted}>
                      {"  "}
                      {splitMarked(row.snippet, query).map((part, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
                        <span key={i} fg={i % 2 === 1 ? theme.accent : theme.textMuted}>
                          {part}
                        </span>
                      ))}
                    </text>
                  )}
                </box>
              </box>
            )
          })
        )}
        {said.kind !== "idle" && hits.length === 0 && (
          <box flexDirection="column">
            <text fg={theme.textMuted}>{t("search.inConversations")}</text>
            {said.kind === "searching" && <text fg={theme.textMuted}>{t("search.searching")}</text>}
            {said.kind === "failed" && <text fg={theme.error}>{t("search.failed", { reason: said.reason })}</text>}
            {said.kind === "done" && <text fg={theme.textMuted}>{t("search.none", { query: said.result.query })}</text>}
          </box>
        )}
        {said.kind === "done" && said.result.truncated && <text fg={theme.textMuted}>{t("search.truncated")}</text>}
        {said.kind === "done" && said.result.skipped.length > 0 && (
          <text fg={theme.textMuted}>{t("search.skipped", { count: said.result.skipped.length })}</text>
        )}
      </box>
      <text fg={theme.textMuted}>{t("help.run")}</text>
    </box>
  )
}

CommandPalette.show = (dialog: DialogContext, search?: PaletteSearch, extras?: readonly PaletteExtra[]): void => {
  const actions = currentPaletteActions()
  dialog.replace(() => <CommandPalette actions={actions} extras={extras} {...(search ? { search } : {})} />)
}

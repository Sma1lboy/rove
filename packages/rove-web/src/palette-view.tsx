/**
 * The command palette (TUI `command-palette.tsx`, prefix `/`): every command the
 * focused pane can run, by the TUI's label with its chord on the right. Rows come
 * from the web's own command registry, so nothing listed is unrunnable. Under the commands it lists
 * the tasks whose title matches (the rail's filter) and, from two characters, what was said in any
 * task's conversations.
 */

import { formatChord } from "@sma1lboy/rove/src/tui/lib/chord-glyphs.ts"
import { matchesHelpAction } from "@sma1lboy/rove/src/tui/lib/help-groups.ts"
import { fuzzyMatch } from "@sma1lboy/rove/src/tui/panes/sidebar/fuzzy.ts"
import { useEffect, useMemo, useRef, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { type Surface, type WebCommand, allCommands, appliesOn, currentSurface } from "./commands.ts"
import { DialogShell } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { actionDesc, helpText } from "./keymap-text.ts"
import { enterWorkspace } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { HitEntry, Note, SectionHead, TaskEntry, useConversationHits } from "./palette-search.tsx"
import { repoLabel } from "./rail.ts"
import { type Hit, MIN_CHARS } from "./search-hits.ts"
import { useStore } from "./store.ts"
import { closeDialog, dialog, toast } from "./ui.ts"
import { DIALOG_BODY } from "./ui/overlay.ts"
import { PALETTE_CHORD, PALETTE_LIST, PALETTE_NAME, paletteRow } from "./ui/shell.ts"
import { INPUT } from "./ui/text.ts"
import { prefixCap, prefixKey, userKeys } from "./user-keys.ts"

/** Rows shown at once; the list scrolls inside (the TUI caps it at ten). */
const VISIBLE_ROWS = 10

interface PaletteRow {
  readonly command: WebCommand
  readonly name: string
  readonly chord: string
  /** What the filter matches against: the raw chord, not its glyphs. */
  readonly raw: string
}

type Entry =
  | { readonly kind: "command"; readonly row: PaletteRow }
  | { readonly kind: "task"; readonly task: TaskRow }
  | { readonly kind: "hit"; readonly hit: Hit }

/** One row per id, most local first (the TUI walks its binding stack top-down); a direct chord beats the prefix form of the same id. */
export function paletteRows(model: AppModel, surface: Surface | null): PaletteRow[] {
  const rank = (command: WebCommand): number => (command.surface === surface ? 0 : command.surface ? 1 : 2)
  const live = allCommands().filter((command) => appliesOn(command, surface) && command.live?.(model) !== false)
  const ordered = live
    .map((command, index) => ({ command, index }))
    .sort(
      (a, b) =>
        rank(a.command) - rank(b.command) || Number(a.command.prefix) - Number(b.command.prefix) || a.index - b.index,
    )
  const seen = new Set<string>()
  const rows: PaletteRow[] = []
  for (const { command } of ordered) {
    const key = command.chords[0]
    if (!key || command.id === "palette.open" || seen.has(command.id)) continue
    seen.add(command.id)
    rows.push({
      command,
      name: actionDesc(command.id),
      chord: command.prefix ? `${prefixCap()} + ${formatChord(key)}` : formatChord(key),
      raw: command.prefix ? `${prefixKey()} + ${key}` : key,
    })
  }
  return rows
}

export function openPalette(model: AppModel): void {
  const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.set(<PaletteDialog model={model} surface={currentSurface()} origin={origin} />)
}

/** Tasks shown under the commands; the list scrolls, but a title match past this is better found by typing more. */
const MAX_TASKS = 8

function PaletteDialog({
  model,
  surface,
  origin,
}: { model: AppModel; surface: Surface | null; origin: HTMLElement | null }) {
  useLocale()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const keys = useStore(userKeys)
  const payload = useStore(model.tasks)
  const remote = useStore(model.remote)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the user's chords moving re-labels the rows
  const rows = useMemo(() => paletteRows(model, surface), [model, surface, keys])
  const shown = rows.filter((row) => matchesHelpAction(query, row.name, row.raw))
  const q = query.trim()
  // The rail's own filter: title, branch or project; a routine's run stays on the Routines page.
  const tasks =
    q === ""
      ? []
      : [...(payload?.tasks ?? []), ...remote]
          .filter(
            (task) =>
              !task.routine &&
              !task.deleting &&
              [task.label, task.title, task.branch, repoLabel(task.repo)].some(
                (field) => field !== "" && fuzzyMatch(q, field),
              ),
          )
          .slice(0, MAX_TASKS)
  const said = useConversationHits(model, query)
  const hits = said.kind === "done" ? said.reply.matches : []
  const entries: readonly Entry[] = [
    ...shown.map((row): Entry => ({ kind: "command", row })),
    ...tasks.map((task): Entry => ({ kind: "task", task })),
    ...hits.map((hit): Entry => ({ kind: "hit", hit })),
  ]
  const index = Math.min(selected, Math.max(0, entries.length - 1))

  // Closing hands focus back to the pane the palette was opened from, as the TUI's dialog stack does.
  useEffect(() => () => origin?.focus(), [origin])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selection moving is the trigger
  useEffect(() => {
    list.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" })
  }, [index])

  const open = (entry: Entry) => {
    closeDialog()
    origin?.focus()
    if (entry.kind === "command") {
      // Re-check: the state may have moved while the palette was open.
      if (entry.row.command.live?.(model) === false) toast(helpText("unavailable"), "error")
      else entry.row.command.run(model)
      return
    }
    if (entry.kind === "task") model.select(entry.task.id)
    else model.select(entry.hit.taskId, entry.hit.tabId ?? null)
    enterWorkspace()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setSelected(Math.min(entries.length - 1, index + 1))
    else if (e.key === "ArrowUp") setSelected(Math.max(0, index - 1))
    else if (e.key === "Enter") {
      const entry = entries[index]
      if (entry) open(entry)
    } else return
    e.preventDefault()
  }

  const extra = q !== "" && (tasks.length > 0 || q.length >= MIN_CHARS)
  let at = 0
  const next = () => at++
  return (
    <DialogShell title={helpText("palette")} wide>
      <div className={`${DIALOG_BODY} palette`} onKeyDown={onKeyDown}>
        <input
          className={INPUT}
          // biome-ignore lint/a11y/noAutofocus: the palette's only field
          autoFocus
          spellCheck={false}
          value={query}
          placeholder={helpText("search")}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
        />
        <div className={PALETTE_LIST} ref={list} style={{ maxHeight: `${(extra ? 18 : VISIBLE_ROWS) * 1.9}em` }}>
          {entries.length === 0 && said.kind !== "searching" && <p className="text-muted">{helpText("noResults")}</p>}
          {extra && shown.length > 0 && <SectionHead>{t("search.commands")}</SectionHead>}
          {shown.map((row) => {
            const i = next()
            return (
              <button
                type="button"
                key={row.command.id}
                className={paletteRow(i === index)}
                onMouseEnter={() => setSelected(i)}
                onClick={() => open({ kind: "command", row })}
              >
                <span className={PALETTE_NAME}>{`${i === index ? "› " : "  "}${row.name}`}</span>
                <span className={`keys-only mono text-accent ${PALETTE_CHORD}`}>{row.chord}</span>
              </button>
            )
          })}
          {tasks.length > 0 && <SectionHead>{t("search.tasks")}</SectionHead>}
          {tasks.map((task) => {
            const i = next()
            return (
              <TaskEntry
                key={task.id}
                title={task.label}
                repo={repoLabel(task.repo)}
                selected={i === index}
                onHover={() => setSelected(i)}
                onOpen={() => open({ kind: "task", task })}
              />
            )
          })}
          {said.kind !== "idle" && <SectionHead>{t("search.inConversations")}</SectionHead>}
          {said.kind === "searching" && <Note>{t("search.searching")}</Note>}
          {said.kind === "failed" && <Note error>{said.message}</Note>}
          {said.kind === "done" && hits.length === 0 && <Note>{t("search.none", { query: said.query })}</Note>}
          {hits.map((hit) => {
            const i = next()
            return (
              <HitEntry
                key={`${hit.taskId}:${hit.tabId ?? ""}:${hit.at}:${i}`}
                hit={hit}
                query={said.kind === "done" ? said.query : ""}
                selected={i === index}
                onHover={() => setSelected(i)}
                onOpen={() => open({ kind: "hit", hit })}
              />
            )
          })}
          {said.kind === "done" && said.reply.truncated && <Note>{t("search.truncated")}</Note>}
          {said.kind === "done" && said.reply.skipped.length > 0 && (
            <Note>{t("search.skipped", { count: said.reply.skipped.length })}</Note>
          )}
        </div>
        <p className="keys-only text-muted">{helpText("run")}</p>
      </div>
    </DialogShell>
  )
}

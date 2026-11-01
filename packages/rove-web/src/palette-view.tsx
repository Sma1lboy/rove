/**
 * The command palette (TUI `command-palette.tsx`, prefix `/`): every command the
 * focused pane can run, by the TUI's label with its chord on the right. Rows come
 * from the web's own command registry, so nothing listed is unrunnable.
 */

import { formatChord } from "@sma1lboy/rove/src/tui/lib/chord-glyphs.ts"
import { matchesHelpAction } from "@sma1lboy/rove/src/tui/lib/help-groups.ts"
import { useEffect, useMemo, useRef, useState } from "react"
import { type Surface, type WebCommand, allCommands, appliesOn, currentSurface } from "./commands.ts"
import { DialogShell } from "./dialogs.tsx"
import { useLocale } from "./i18n/index.ts"
import { actionDesc, helpText } from "./keymap-text.ts"
import type { AppModel } from "./model.ts"
import { useStore } from "./store.ts"
import { closeDialog, dialog, toast } from "./ui.ts"
import { DIALOG_BODY } from "./ui/overlay.ts"
import { PALETTE_LIST, paletteRow } from "./ui/shell.ts"
import { INPUT, MONO } from "./ui/text.ts"
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: the user's chords moving re-labels the rows
  const rows = useMemo(() => paletteRows(model, surface), [model, surface, keys])
  const shown = rows.filter((row) => matchesHelpAction(query, row.name, row.raw))
  const index = Math.min(selected, Math.max(0, shown.length - 1))

  // Closing hands focus back to the pane the palette was opened from, as the TUI's dialog stack does.
  useEffect(() => () => origin?.focus(), [origin])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selection moving is the trigger
  useEffect(() => {
    list.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" })
  }, [index])

  const run = (row: PaletteRow) => {
    closeDialog()
    origin?.focus()
    // Re-check: the state may have moved while the palette was open.
    if (row.command.live?.(model) === false) toast(helpText("unavailable"), "error")
    else row.command.run(model)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setSelected(Math.min(shown.length - 1, index + 1))
    else if (e.key === "ArrowUp") setSelected(Math.max(0, index - 1))
    else if (e.key === "Enter") {
      const row = shown[index]
      if (row) run(row)
    } else return
    e.preventDefault()
  }

  return (
    <DialogShell title={helpText("palette")} wide>
      <div className={`${DIALOG_BODY} palette`} onKeyDown={onKeyDown}>
        <input
          className={`${INPUT} text-ink`}
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
        <div className={PALETTE_LIST} ref={list} style={{ maxHeight: `${VISIBLE_ROWS * 1.9}em` }}>
          {shown.length === 0 && <p className="text-muted">{helpText("noResults")}</p>}
          {shown.map((row, i) => (
            <button
              type="button"
              key={row.command.id}
              className={paletteRow(i === index)}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(row)}
            >
              <span>{`${i === index ? "› " : "  "}${row.name}`}</span>
              <span className={`keys-only ${MONO} text-accent`}>{row.chord}</span>
            </button>
          ))}
        </div>
        <p className="keys-only text-muted">{helpText("run")}</p>
      </div>
    </DialogShell>
  )
}

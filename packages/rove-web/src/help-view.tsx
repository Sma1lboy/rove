/**
 * F1 keybinding help (TUI `help-dialog.tsx`): the same grammar sections
 * (here / one press / after prefix / other pane) from the TUI's own
 * `grammarHelpSections`, fed only the bindings the web handles.
 */

import { formatChord } from "@sma1lboy/rove/src/tui/lib/chord-glyphs.ts"
import {
  type HelpGrammarSection,
  type HelpSurface,
  grammarHelpSections,
  matchesHelpAction,
  scopeCategory,
} from "@sma1lboy/rove/src/tui/lib/help-groups.ts"
import { useEffect, useMemo, useRef, useState } from "react"
import { type Surface, boundKeymap, currentSurface, reachability } from "./commands.ts"
import { DialogShell } from "./dialogs.tsx"
import { useLocale } from "./i18n/index.ts"
import { actionDesc, categoryName, helpText } from "./keymap-text.ts"
import type { AppModel } from "./model.ts"
import { useStore } from "./store.ts"
import { closeDialog, dialog } from "./ui.ts"
import { DIALOG_BODY } from "./ui/overlay.ts"
import { HELP_CAP, HELP_CORNER, HELP_HEAD, HELP_ROW, HELP_SCROLL, HELP_SECTION, HELP_TITLE } from "./ui/shell.ts"
import { INPUT, LINK } from "./ui/text.ts"
import { prefixCap, prefixKey, userKeys } from "./user-keys.ts"

const displayCap = (cap: string): string =>
  cap
    .split(" + ")
    .map((part) => formatChord(part))
    .join(" + ")

function sectionTitle(section: HelpGrammarSection): string {
  const surface = categoryName(scopeCategory(section.scope))
  if (section.kind === "here") return helpText("here", { surface })
  if (section.kind === "direct") return helpText("direct")
  if (section.kind === "prefix") return helpText("afterPrefix")
  return helpText("otherPane", { surface })
}

export function openHelp(model: AppModel): void {
  const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.set(<HelpDialog model={model} surface={currentSurface()} origin={origin} />)
}

function HelpDialog({
  model,
  surface,
  origin,
}: { model: AppModel; surface: Surface | null; origin: HTMLElement | null }) {
  useLocale()
  const keys = useStore(userKeys)
  const [filtering, setFiltering] = useState(false)
  const [query, setQuery] = useState("")
  const scroll = useRef<HTMLDivElement>(null)
  const reach = useMemo(() => reachability(model, surface), [model, surface])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the user's chords moving re-labels the rows
  const sections = useMemo(
    () =>
      grammarHelpSections(
        boundKeymap(),
        (surface === "terminal" ? "terminal" : surface) as HelpSurface | null,
        prefixKey(),
        reach,
      ),
    [reach, surface, keys],
  )
  const shown = sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => matchesHelpAction(query, actionDesc(row.binding.id), row.primary)),
    }))
    .filter((section) => section.rows.length > 0)

  useEffect(() => () => origin?.focus(), [origin])
  useEffect(() => {
    const box = scroll.current
    // Native navigation keys only: no new Rove-owned chords (TUI help).
    const onKey = (e: KeyboardEvent) => {
      if (!box || e.ctrlKey || e.metaKey || e.altKey) return
      const page = box.clientHeight
      if (e.key === "ArrowUp") box.scrollBy({ top: -24 })
      else if (e.key === "ArrowDown") box.scrollBy({ top: 24 })
      else if (e.key === "PageUp") box.scrollBy({ top: -page })
      else if (e.key === "PageDown") box.scrollBy({ top: page })
      else if (e.key === "Home") box.scrollTo({ top: 0 })
      else if (e.key === "End") box.scrollTo({ top: box.scrollHeight })
      else if (!filtering && e.key === "?") closeDialog()
      else if (!filtering && e.key === "/") setFiltering(true)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [filtering])

  return (
    <DialogShell title={helpText("title")} wide>
      <div className={`${DIALOG_BODY} help`}>
        <div className={HELP_HEAD}>
          <div>
            <p className="text-muted">
              {surface
                ? helpText("focused", { surface: categoryName(scopeCategory(surface)) })
                : helpText("allBindings")}
            </p>
            <p className="text-muted">{helpText("grammar", { prefix: prefixCap() })}</p>
          </div>
          <div className={HELP_CORNER}>
            <span className="subtle">{helpText("scrollKeys")}</span>
            <button type="button" className={LINK} onClick={closeDialog}>
              {helpText("esc")}
            </button>
          </div>
        </div>
        {filtering ? (
          <input
            className={INPUT}
            // biome-ignore lint/a11y/noAutofocus: the filter row replaces the hint
            autoFocus
            spellCheck={false}
            value={query}
            placeholder={helpText("search")}
            onChange={(e) => {
              setQuery(e.target.value)
              scroll.current?.scrollTo({ top: 0 })
            }}
          />
        ) : (
          <p className="text-muted">{helpText("filter")}</p>
        )}
        {shown.length === 0 && <p className="text-muted">{helpText("noResults")}</p>}
        <div className={HELP_SCROLL} ref={scroll}>
          {shown.map((section, i) => (
            <section key={`${section.kind}-${section.scope ?? i}`} className={HELP_SECTION}>
              <h2 className={HELP_TITLE}>{sectionTitle(section)}</h2>
              {section.rows.map((row) => (
                <div key={`${section.kind}-${row.binding.id}`} className={HELP_ROW}>
                  <span className={`mono ${HELP_CAP}`}>{displayCap(row.primary)}</span>
                  <span className="flex-1">{actionDesc(row.binding.id)}</span>
                  {row.aliases.length > 0 && (
                    <span className="text-muted">{`(${row.aliases.map(displayCap).join(", ")})`}</span>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </DialogShell>
  )
}

/** The rail's `/` filter line: a real field, so a phone can type; the arrows, Enter and Esc stay with the rail's keys. */

import { useEffect, useRef } from "react"
import { t } from "./i18n/index.ts"
import { RAIL_SEARCH, RAIL_SEARCH_FIELD } from "./ui/rail.ts"

export function SearchChip(props: { query: string; count: string; onChange: (query: string) => void }) {
  const field = useRef<HTMLInputElement>(null)
  // Closing removes the field; the rail takes the focus back so its keys keep answering.
  useEffect(() => {
    const input = field.current
    return () => {
      if (input && document.activeElement === input) input.closest("nav")?.focus()
    }
  }, [])
  return (
    <div className={`${RAIL_SEARCH} mono items-center`}>
      <span className="text-accent">/</span>
      <input
        ref={field}
        className={RAIL_SEARCH_FIELD}
        type="text"
        // biome-ignore lint/a11y/noAutofocus: the chip exists only to be typed into
        autoFocus
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        enterKeyHint="go"
        value={props.query}
        placeholder={t("rail.searchPlaceholder")}
        aria-label={t("rail.searchPlaceholder")}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.query && <span className="ml-1.5 text-muted">{props.count}</span>}
    </div>
  )
}

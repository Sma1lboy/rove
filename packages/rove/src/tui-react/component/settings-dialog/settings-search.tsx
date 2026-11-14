/** @jsxImportSource @opentui/react */
/**
 * Settings search: `/` swaps the two-column body for a field and one list of
 * matching rows from every searchable section; enter lands the cursor on the
 * picked row in its own section, where it activates as usual.
 */

import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import type { SectionId } from "../../../tui/component/settings-dialog/model"
import { type SettingsSearchHit, searchSettings } from "../../../tui/component/settings-dialog/search"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { useBindings } from "../../lib/keymap"
import { useCursorFollow } from "../../lib/use-cursor-follow"
import { INPUT_SCROLL } from "../../ui/input-scroll"
import { Row } from "./rows"

export function useSettingsSearch(opts: {
  /** False while a sub-dialog, the feedback form or a key recording owns the keyboard. */
  enabled: boolean
  index: () => SettingsSearchHit[]
  jump: (hit: SettingsSearchHit) => void
}) {
  const t = useT()
  const [active, setActive] = useState(false)
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const sectionLabel = (section: SectionId) => t(`settings.sections.${section}`)
  const hits = active ? searchSettings(opts.index(), query, sectionLabel) : []
  const selected = Math.min(cursor, Math.max(0, hits.length - 1))

  function close(): void {
    setActive(false)
    setQuery("")
    setCursor(0)
  }
  function pick(hit: SettingsSearchHit | undefined): void {
    if (!hit) return
    close()
    opts.jump(hit)
  }
  const move = (delta: number) => () => {
    if (hits.length > 0) setCursor((selected + delta + hits.length) % hits.length)
  }

  useBindings(() => ({
    enabled: opts.enabled,
    bindings: active
      ? [
          { key: "down", cmd: move(1) },
          { key: "up", cmd: move(-1) },
          { key: "escape", cmd: close },
          { key: "ctrl+c", cmd: close },
        ]
      : [{ key: "/", cmd: () => setActive(true) }],
  }))

  return {
    active,
    query,
    hits,
    selected,
    setQuery(value: string): void {
      setQuery(value)
      setCursor(0)
    },
    pick,
  }
}

export type SettingsSearch = ReturnType<typeof useSettingsSearch>

export function SettingsSearchView(props: { search: SettingsSearch }) {
  const { theme } = useTheme()
  const t = useT()
  const { search } = props
  const follow = useCursorFollow(search.selected)
  return (
    <box flexDirection="column" gap={1} flexGrow={1} flexShrink={1}>
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        {t("settings.title")}
      </text>
      <input
        {...INPUT_SCROLL}
        focused
        value={search.query}
        placeholder={t("settings.search.placeholder")}
        onInput={(value: string) => search.setQuery(value)}
        onSubmit={() => search.pick(search.hits[search.selected])}
      />
      {search.query.trim() && search.hits.length === 0 ? (
        <text fg={theme.textMuted}>{t("settings.search.noResults")}</text>
      ) : null}
      <scrollbox ref={follow.scrollRef} flexGrow={1} flexShrink={1} flexBasis={0}>
        {search.hits.map((hit, i) => {
          const cursor = i === search.selected
          return (
            <Row
              key={`${hit.section}:${hit.row.id}`}
              cursor={cursor}
              rowRef={follow.rowRef(i)}
              onMouseUp={() => search.pick(hit)}
              fg={theme.text}
              hint={`· ${[t(`settings.sections.${hit.section}`), hit.group].filter(Boolean).join(" › ")}`}
            >
              {hit.label}
            </Row>
          )
        })}
      </scrollbox>
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
        {t("settings.search.nav")}
      </text>
    </box>
  )
}

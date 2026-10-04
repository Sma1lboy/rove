/** @jsxImportSource @opentui/react */
/**
 * Settings → Marketplace. Two lines per listed plugin, the same shape the
 * Plugins section uses: a navigable `owner/repo  ★12` row (tagged `installed`
 * and dimmed once it is in the registry) over a muted description line. Two
 * lines rather than three columns because a `owner/repo/subdir` ref plus a
 * repo blurb does not fit one 110-cell row — side by side they clip into each
 * other mid-word. Enter previews the install (every command it would run) and
 * asks before anything executes — that gate lives in `use-section-data`; this
 * file only maps rows to boxes.
 */

import { type BoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import type { MarketplaceRowView } from "./marketplace-core"
import type { SectionCursorProps } from "./rows"

function MarketRow(props: {
  row: MarketplaceRowView
  cursor: boolean
  rowRef: (r: BoxRenderable | null) => (() => void) | undefined
  onActivate: () => void
}) {
  const { theme } = useTheme()
  const t = useT()
  const { row } = props
  const installed = row.installedId !== null
  return (
    <box flexDirection="column" gap={0}>
      <box
        ref={props.rowRef}
        flexDirection="row"
        gap={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={props.cursor ? theme.primary : undefined}
        onMouseUp={props.onActivate}
      >
        <text
          fg={props.cursor ? theme.selectedListItemText : installed ? theme.textMuted : theme.accent}
          attributes={TextAttributes.BOLD}
          wrapMode="none"
        >
          {row.ref}
        </text>
        <text fg={props.cursor ? theme.selectedListItemText : theme.textMuted} wrapMode="none">
          {installed
            ? t("settings.marketplace.installedTag")
            : row.stars !== null
              ? `★${row.stars}`
              : row.firstParty
                ? t("settings.marketplace.firstParty")
                : ""}
        </text>
      </box>
      {row.desc ? (
        <box flexDirection="row" paddingLeft={5} paddingRight={1}>
          {/* Repo description is publisher-owned text, shown raw. */}
          <text fg={theme.textMuted} wrapMode="none">
            {row.desc}
          </text>
        </box>
      ) : null}
    </box>
  )
}

export function MarketplaceSettingsSection(
  props: SectionCursorProps & {
    rows: readonly MarketplaceRowView[]
    loading: boolean
    offline: boolean
    /** Phase or outcome of the last install attempt; "" when idle. */
    status: string
    install: (ref: string) => void
  },
) {
  const { theme } = useTheme()
  const t = useT()
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {t("settings.marketplace.title")}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {t("settings.marketplace.hint")}
      </text>
      {props.offline ? (
        <text fg={theme.warning} wrapMode="word">
          {t("settings.marketplace.offline")}
        </text>
      ) : null}
      {props.status ? (
        <text fg={theme.accent} wrapMode="word">
          {props.status}
        </text>
      ) : null}
      {props.loading ? (
        <text fg={theme.textMuted}>{t("settings.marketplace.loading")}</text>
      ) : props.rows.length === 0 ? (
        <text fg={theme.textMuted}>{t("settings.marketplace.empty")}</text>
      ) : (
        <box flexDirection="column" gap={0}>
          {props.rows.map((row, i) => (
            <MarketRow
              key={row.ref}
              row={row}
              cursor={props.level === "body" && props.bodyRow === i}
              rowRef={props.rowRef(i)}
              onActivate={() => {
                props.setLevel("body")
                props.setBodyRow(i)
                props.install(row.ref)
              }}
            />
          ))}
        </box>
      )}
    </box>
  )
}

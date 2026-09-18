/** @jsxImportSource @opentui/react */
/**
 * Settings → Auto effort: one row per depth tier, each showing the
 * engine · model · effort it launches, with the gate's verdict under it.
 * Enter opens the change-engine picker on that row. The prose above names
 * what the tiers are FOR; the rows name what they RUN — the two never quote
 * each other (see `engine/auto-effort.ts`).
 */

import { TextAttributes } from "@opentui/core"
import { type AutoEffortTier, describeTierBlock } from "../../../engine/auto-effort"
import { engineDisplayName } from "../../../engine/interactive-command"
import { autoEffortRows, rowIndex } from "../../../tui/component/settings-dialog/model"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { Row, type SectionCursorProps } from "./rows"
import type { AutoEffortSettings } from "./use-auto-effort-settings"

export function AutoEffortSettingsSection(props: SectionCursorProps & { autoEffort: AutoEffortSettings }) {
  const { theme } = useTheme()
  const t = useT()
  const rows = autoEffortRows()
  const { table } = props.autoEffort
  const isBodyCursor = (row: number) => props.level === "body" && props.bodyRow === row
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {t("settings.autoEffort.title")}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {t("settings.autoEffort.hint")}
      </text>
      {table === null ? (
        <text fg={theme.warning} wrapMode="word">
          {t("settings.autoEffort.unconfigured")}
        </text>
      ) : null}
      <box flexDirection="column" gap={0}>
        {rows.map((row) => {
          if (row.kind !== "autoEffortTier") return null
          const tier: AutoEffortTier = row.tier
          const i = rowIndex(rows, row.id)
          const target = table?.[tier]
          const block = props.autoEffort.block(tier)
          const label = `${t(`tasks.tier.${tier}`)}`.padEnd(10)
          const fields = target
            ? [
                engineDisplayName(target.engine),
                target.model ?? t("settings.autoEffort.engineDefault"),
                target.effort ?? t("settings.autoEffort.engineDefault"),
              ].join(" · ")
            : "—"
          return (
            <box key={row.id} flexDirection="column" gap={0}>
              <Row
                cursor={isBodyCursor(i)}
                rowRef={props.rowRef(i)}
                onMouseUp={() => {
                  props.setLevel("body")
                  props.setBodyRow(i)
                  void props.autoEffort.edit(tier)
                }}
                fg={theme.text}
                bold
                hint={fields}
              >
                {label}
              </Row>
              <box flexDirection="row" gap={1} paddingLeft={3} overflow="hidden">
                <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
                  {t(`tasks.tierDesc.${tier}`)}
                </text>
              </box>
              <box flexDirection="row" gap={1} paddingLeft={3} overflow="hidden">
                {block === undefined ? (
                  <text fg={theme.textMuted}>{t("settings.accounts.checking")}</text>
                ) : block === null ? (
                  <text fg={theme.success}>{t("settings.autoEffort.ready")}</text>
                ) : (
                  <text fg={theme.warning} wrapMode="none" flexShrink={1}>
                    {t("settings.autoEffort.unavailable", { reason: describeTierBlock(block) })}
                  </text>
                )}
              </box>
            </box>
          )
        })}
      </box>
    </box>
  )
}

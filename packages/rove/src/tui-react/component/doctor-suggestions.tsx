/** @jsxImportSource @opentui/react */
import type { DoctorFix } from "../../cli/doctor-fix"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

export function DoctorSuggestions({ fixes }: { fixes: readonly DoctorFix[] }) {
  const { theme } = useTheme()
  const t = useT()
  return (
    <box gap={1}>
      {fixes.map((fix) => (
        <box key={fix.id}>
          <text fg={theme.warning} wrapMode="word">
            {fix.label}
          </text>
          <text fg={theme.primary} wrapMode="word">
            {fix.kind === "manual" ? fix.action : fix.command.join(" ")}
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            {fix.why}
          </text>
        </box>
      ))}
      <text fg={theme.textMuted} wrapMode="word">
        {t("common.failureHint", { command: "rove doctor" })}
      </text>
    </box>
  )
}

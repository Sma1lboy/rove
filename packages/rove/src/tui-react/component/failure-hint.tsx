/** @jsxImportSource @opentui/react */
import { failureHint } from "../../lib/failure-hint"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

export function FailureHint({ error, hint }: { error?: unknown; hint?: string }) {
  const { theme } = useTheme()
  useT()
  return (
    <text fg={theme.textMuted} wrapMode="word">
      {hint ?? failureHint(error)}
    </text>
  )
}

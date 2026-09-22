/** @jsxImportSource @opentui/react */
/**
 * Third line of an engine card: which of Rove's three reporting layers this
 * engine uses, and what is on disk for the one that must be INSTALLED
 * (`engine/integration-status.ts` owns the reading). This is what ROVE
 * installed into the engine; `sections-engines.tsx` renders what the user
 * configures.
 *
 * Three cells, never a score. A missing layer is normal (claude's hooks report
 * its permission prompt, so screen rules would be dead code), so it is muted;
 * only a layer meant to be installed and missing gets a warning colour.
 */

import type { ReactNode } from "react"
import type { EngineIntegration, HookInstallState } from "../../../engine/integration-status"
import { tildify } from "../../../lib/path-home"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"

/**
 * i18n key and warn flag per hook state; `warn` is the only reading asking for
 * a person. A fourth reading, "unavailable", is derived below: a missing hook
 * on an engine whose CLI isn't on this machine is muted, not a warning, or the
 * section always looks broken.
 */
const HOOK_STATES: Readonly<Record<HookInstallState, { key: string; warn: boolean }>> = {
  installed: { key: "settings.engines.hookInstalled", warn: false },
  outdated: { key: "settings.engines.hookOutdated", warn: true },
  "not-installed": { key: "settings.engines.hookMissing", warn: true },
}

export function EngineIntegrationLine(props: {
  integration: EngineIntegration | null
  /** Whether the engine's own binary was found. `undefined` = the probe has
   *  not landed, which reads as "assume present" so a card does not flicker
   *  through "not installed" on its way to the truth. */
  binaryFound?: boolean
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const row = props.integration
  // Reserve the line while probing: a card growing mid-render pushes the rows
  // (and the cursor) below it.
  if (!row) return <box paddingLeft={6} />
  const absent = row.hooksSupported && row.hookState === "not-installed" && props.binaryFound === false
  const hook = row.hooksSupported && !absent ? HOOK_STATES[row.hookState] : null
  const hookLabel = hook ? t(hook.key) : absent ? t("settings.engines.hookUnavailable") : t("settings.engines.hookNone")
  return (
    <box flexDirection="row" gap={2} paddingLeft={6} overflow="hidden">
      <text fg={hook === null ? theme.textMuted : hook.warn ? theme.warning : theme.success} wrapMode="none">
        {hookLabel}
      </text>
      <text fg={row.markers ? theme.text : theme.textMuted} wrapMode="none">
        {row.markers ? t("settings.engines.markersYes") : t("settings.engines.markersNo")}
      </text>
      <text fg={row.screen ? theme.text : theme.textMuted} wrapMode="none">
        {row.screen ? t("settings.engines.screenYes") : t("settings.engines.screenNo")}
      </text>
      {/* The refused-merge line. Today this failure's only symptom is that
          every badge for the engine falls back to the daemon's ~10s poll,
          with nothing on screen naming the file responsible. */}
      {row.configIssue ? (
        <text fg={theme.error} wrapMode="none" flexShrink={1}>
          {t("settings.engines.hookRefused", { file: tildify(row.hookFile), reason: row.configIssue })}
        </text>
      ) : null}
    </box>
  )
}

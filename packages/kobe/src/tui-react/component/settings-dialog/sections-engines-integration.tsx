/** @jsxImportSource @opentui/react */
/**
 * The third line of an engine card: which of Rove's three reporting layers
 * this engine uses, and — for the one layer that has to be INSTALLED — what
 * is on disk right now (`engine/integration-status.ts` owns the reading).
 *
 * Its own file, not `sections-engines.tsx`: that one renders what the user
 * CONFIGURES (the switch, the default marker, the launch command) plus what
 * detection found about the engine's own install; this renders what ROVE
 * installed into the engine. The two halves change for different reasons.
 *
 * Three cells, never a score. A missing layer is normal — claude's hooks
 * report its permission prompt, so screen rules would be dead code there —
 * so an absent layer is a muted dash, and only a layer that is meant to be
 * installed and is not gets a warning colour.
 */

import type { ReactNode } from "react"
import type { EngineIntegration, HookInstallState } from "../../../engine/integration-status"
import { tildify } from "../../../lib/path-home"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"

/**
 * i18n key and tone for each hook state.
 *
 * FOUR readings, not three: "supported but absent" splits on whether the CLI
 * is even on this machine. Without that split every engine the user has not
 * installed wore the same warning as one whose install genuinely failed, so
 * the section always looked broken and the colour stopped meaning anything.
 * `tone` is what the row paints: `warn` is the only one asking for a person.
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
  // Reserve the line while the probe is in flight rather than growing the
  // card when it lands: a card that gets taller mid-render pushes every row
  // below it, and the cursor is somewhere down there.
  if (!row) return <box paddingLeft={6} />
  // An engine with no CLI here has nothing to install INTO: the missing hook
  // is a consequence, not a fault, so it drops to the muted reading.
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

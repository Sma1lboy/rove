/** @jsxImportSource @opentui/react */
import { useEffect, useState } from "react"
import { type EngineStatus, detectEngineStatus } from "../../engine/engine-status"
import { createEngineHookAdapter } from "../../engine/hook-adapter"
import { type EngineIntegration, engineIntegrations } from "../../engine/integration-status"
import type { VendorId } from "../../types/vendor"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

export type HookReadiness = { status: EngineStatus; integration: EngineIntegration }
async function probeReadiness(vendor: VendorId): Promise<HookReadiness> {
  const status = await detectEngineStatus(vendor)
  const integration = engineIntegrations([vendor])[0]
  if (!integration) throw new Error("No integration status")
  return { status, integration }
}

/** Only engines declaring a manual trust step get this first-task guidance. */
export function EngineHookReadiness(props: {
  vendor: VendorId
  /** Session identity comes from a hook payload, never from a screen/poll badge. */
  hookSessionId?: string
  probe?: (vendor: VendorId) => Promise<HookReadiness>
}) {
  const command = createEngineHookAdapter(props.vendor).setupCommand
  if (!command) return null
  return <ReadinessDetails key={props.vendor} {...props} command={command} />
}

function ReadinessDetails(props: {
  vendor: VendorId
  command: string
  hookSessionId?: string
  probe?: (vendor: VendorId) => Promise<HookReadiness>
}) {
  const { theme } = useTheme()
  const t = useT()
  const [result, setResult] = useState<HookReadiness | "failed" | null>(null)
  const received = Boolean(props.hookSessionId)
  const probe = props.probe ?? probeReadiness
  // biome-ignore lint/correctness/useExhaustiveDependencies: a received event rechecks hooks written during launch.
  useEffect(() => {
    let alive = true
    void probe(props.vendor).then(
      (value) => {
        if (alive) setResult(value)
      },
      () => {
        if (alive) setResult("failed")
      },
    )
    return () => {
      alive = false
    }
  }, [probe, props.vendor, received])
  const line =
    result && result !== "failed"
      ? t("settings.engines.readiness", {
          cli: t(`settings.engines.${result.status.binary.found ? "cliReady" : "cliMissing"}`),
          login: t(
            `settings.engines.${result.status.accountError || result.status.account === null ? "readinessUnknown" : result.status.account.kind === "none" ? "loginMissing" : "loginReady"}`,
          ),
          hooks: t(
            `settings.engines.${result.integration.hookState === "installed" ? "hooksWritten" : result.integration.hookState === "outdated" ? "hooksOutdated" : "hooksMissing"}`,
          ),
        })
      : null
  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
      {line ? (
        <text fg={theme.textMuted} wrapMode="word">
          {line}
        </text>
      ) : null}
      {result === "failed" ? (
        <text fg={theme.warning} wrapMode="word">
          {t("settings.engines.readinessFailed")}
        </text>
      ) : null}
      <text fg={theme.warning} wrapMode="word">
        {t("settings.engines.hookTrustHint", { command: props.command })}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {t(`settings.engines.${received ? "hookReceived" : "hookWaiting"}`)}
      </text>
    </box>
  )
}

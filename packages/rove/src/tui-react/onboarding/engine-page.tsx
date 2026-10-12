/** @jsxImportSource @opentui/react */
import { engineDisplayName } from "../../engine/interactive-command"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import type { WelcomeEnv } from "../workspace/welcome-pane"

export function EngineWelcomePage(props: { env: WelcomeEnv | null; onContinue: () => void }) {
  const { theme } = useTheme()
  const t = useT()
  const env = props.env
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text}>{t("onboarding.engineTitle")}</text>
      {env === null ? (
        <text fg={theme.textMuted}>{t("onboarding.engineChecking")}</text>
      ) : (
        <>
          <text fg={env.engines.length ? theme.success : theme.warning}>
            {t(env.engines.length ? "onboarding.engineReady" : "onboarding.engineMissing")}
          </text>
          {env.engines.map((id) => (
            <text key={id} fg={theme.textMuted}>
              {t("onboarding.engineUsable", { engine: engineDisplayName(id) })}
            </text>
          ))}
          {env.signedOut.map((id) => (
            <text key={id} fg={theme.warning}>
              {t("onboarding.engineSignedOut", { engine: engineDisplayName(id) })}
            </text>
          ))}
          {env.engines.length === 0 ? (
            <text fg={theme.textMuted} wrapMode="word">
              {t("onboarding.engineSetup")}
            </text>
          ) : null}
          {!env.git ? <text fg={theme.warning}>{t("workspace.welcome.gitMissing")}</text> : null}
          <box onMouseUp={props.onContinue}>
            <text fg={theme.primary}>{t("onboarding.engineContinue")}</text>
          </box>
        </>
      )}
    </box>
  )
}

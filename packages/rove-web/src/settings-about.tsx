/**
 * Settings → About: the daemon's build, the release channel and update notice, a check for updates, and this
 * browser's sign-out. "Check for updates" asks the Mac's Rove build (`update.check`, forced) what the npm
 * registry holds for the chosen channel's dist-tag and shows it beside the running version. Installing is the
 * Update page's (release notes, Update now) or the `rove update` command.
 */

import { RELEASE_CHANNELS } from "@sma1lboy/rove/src/release-channels.ts"
import { useEffect, useState } from "react"
import { saveToken } from "./auth.ts"
import type { BridgeClient } from "./bridge.ts"
import { t } from "./i18n/index.ts"
import { openPage } from "./layout.ts"
import { signOut } from "./login.ts"
import { type Prefs, setPref, usePrefs } from "./prefs.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { ts } from "./settings-copy.ts"
import { Choice, Group, Row, Toggle } from "./settings-rows.tsx"
import { useStore } from "./store.ts"
import { Button } from "./ui/button.tsx"
import { SETTINGS_INPUT, SETTINGS_VALUE } from "./ui/settings.ts"
import { checkForUpdate, updateState, useCatalog } from "./update-view.tsx"

type DaemonInfo = { daemonVersion?: string; stale?: boolean }

const fill = (template: string, version: string) => template.replace("{version}", version)

function UpdateRows({ client }: { client: BridgeClient }) {
  const u = useCatalog()
  const state = useStore(updateState)
  const { prefs } = usePrefs()
  const [phase, setPhase] = useState<"idle" | "checking" | "done" | "failed">("idle")
  const run = () => {
    setPhase("checking")
    void checkForUpdate(client, prefs.updateChannel).then((ok) => setPhase(ok ? "done" : "failed"))
  }
  // A result belongs to the channel it was asked of: picking another one clears it.
  const pick = (next: Prefs["updateChannel"]) => {
    setPhase("idle")
    void setPref(client, "updateChannel", next)
  }
  const info = state?.info ?? null
  const unknown = phase === "failed" || (phase === "done" && info === null)
  const result =
    phase === "done" && state && info
      ? info.hasUpdate
        ? fill(u.available, info.latest)
        : u.upToDate
      : unknown
        ? u.latestUnknown
        : undefined
  const tone = unknown ? "text-muted" : info?.hasUpdate ? "text-warning" : "text-success"
  return (
    <>
      <Choice
        label={ts("general.updateChannelTitle")}
        hint={ts("general.updatesHint")}
        value={prefs.updateChannel}
        picks={RELEASE_CHANNELS.map((value) => ({ value, label: ts(`general.updateChannelName.${value}`) }))}
        onPick={pick}
      />
      <Toggle
        label={ts("general.updateNotify")}
        hint={ts("general.updateNotifyHint")}
        checked={prefs.updateNotify}
        onChange={(next) => void setPref(client, "updateNotify", next)}
      />
      <Row label={ts("general.updates")} hint={ts("general.updateCheckHint")}>
        {phase === "done" && info?.hasUpdate && (
          <Button variant="action" onClick={() => openPage("update")}>
            {ts("general.updateOpenPage")}
          </Button>
        )}
        <Button variant="action" disabled={phase === "checking"} onClick={run}>
          {phase === "checking" ? ts("general.updateChecking") : ts("general.updateCheckButton")}
        </Button>
      </Row>
      {result && (
        <Row
          label={<span className={tone}>{result}</span>}
          hint={info?.hasUpdate ? <code className="font-mono">rove update</code> : undefined}
        >
          {phase === "done" && state && info && (
            <span className={SETTINGS_VALUE} title={`${u.latest} v${info.latest}`}>
              {`${u.current} v${state.current} · ${u.latest} v${info.latest}`}
            </span>
          )}
        </Row>
      )}
    </>
  )
}

type SignInMode = "open" | "password" | "token"
interface SignInStatus {
  readonly mode: SignInMode
  readonly modes: readonly SignInMode[]
  readonly hasPassword: boolean
  readonly minPassword: number
}

/** How a browser gets in: nothing asked on this computer, a password, or only the token link. */
function SignInRows({ client }: { client: BridgeClient }) {
  const [status, setStatus] = useState<SignInStatus | null>(null)
  // Password picked with none set yet: the mode changes once one is typed.
  const [asking, setAsking] = useState(false)
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const read = () => client.request<SignInStatus>("auth.status").then(setStatus, () => setStatus(null))
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per client
  useEffect(() => void read(), [client])
  if (!status) return null
  const set = async (mode: SignInMode, withPassword?: string): Promise<void> => {
    setError(null)
    try {
      const args = withPassword === undefined ? { mode } : { mode, password: withPassword }
      const { token } = await client.request<{ token?: string }>("auth.setMode", args)
      // Leaving "no sign-in" ends tokenless sessions: keep this browser in, then reconnect with its token.
      if (token) {
        saveToken(token)
        window.location.reload()
        return
      }
      setAsking(false)
      setPassword("")
      await read()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const shown = asking ? "password" : status.mode
  const short = password.length < status.minPassword
  return (
    <Group title={t("settings.about.access")}>
      <Choice
        label={t("settings.about.signIn")}
        hint={t(`settings.about.signInHint.${shown}`)}
        value={shown}
        picks={status.modes.map((value) => ({ value, label: t(`settings.about.signInMode.${value}`) }))}
        onPick={(mode) => {
          if (mode === "password" && !status.hasPassword) setAsking(true)
          else void set(mode)
        }}
      />
      {shown === "password" && (
        <Row
          label={t(status.hasPassword ? "settings.about.passwordChange" : "settings.about.passwordSet")}
          hint={error ?? t("settings.about.passwordHint", { min: status.minPassword })}
        >
          <input
            className={`${SETTINGS_INPUT} w-48`}
            type="password"
            autoComplete="new-password"
            aria-label={t("settings.about.passwordField")}
            placeholder={t("settings.about.passwordField")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !short && void set("password", password)}
          />
          <Button variant="action" disabled={short} onClick={() => void set("password", password)}>
            {t("settings.about.passwordSave")}
          </Button>
        </Row>
      )}
    </Group>
  )
}

export function AboutSection({ client }: { client: BridgeClient }) {
  const [daemon, setDaemon] = useState<DaemonInfo | null>(() => lastReply<DaemonInfo>(client, "daemon.info") ?? null)
  useEffect(() => {
    void requestRemembered<DaemonInfo>(client, "daemon.info").then(setDaemon, () => setDaemon(null))
  }, [client])
  return (
    <>
      <Group title={t("settings.about.groupRove")}>
        {daemon?.daemonVersion && (
          <Row
            label={t("settings.about.daemon")}
            hint={t(daemon.stale ? "settings.about.daemonStale" : "settings.about.daemonCurrent", {
              version: daemon.daemonVersion,
            })}
          />
        )}
        <UpdateRows client={client} />
      </Group>
      <SignInRows client={client} />
      <Group title={t("settings.about.browser")}>
        <Row label={t("settings.about.signOut")} hint={t("settings.about.browserHint")}>
          <Button variant="action" onClick={() => void signOut().then(() => window.location.reload())}>
            {t("settings.about.signOut")}
          </Button>
        </Row>
      </Group>
    </>
  )
}

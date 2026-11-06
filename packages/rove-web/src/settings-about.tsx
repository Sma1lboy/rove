/**
 * Settings → About: the daemon's build, the release channel and update notice, a check for updates, and this
 * browser's sign-out. "Check for updates" asks the Mac's Rove build (`update.check`, forced) what the npm
 * registry holds for the chosen channel's dist-tag and shows it beside the running version. Installing stays a
 * command on that Mac: the bridge never runs the updater, so the action is the Update page (release notes,
 * link) and the `rove update` command.
 */

import { RELEASE_CHANNELS } from "@sma1lboy/rove/src/version.ts"
import { useEffect, useState } from "react"
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
import { SETTINGS_VALUE } from "./ui/settings.ts"
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
            <span className={SETTINGS_VALUE}>{`${u.current} v${state.current} · ${u.latest} v${info.latest}`}</span>
          )}
        </Row>
      )}
    </>
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

/** Settings → Notifications: what announces a task, in this page, by sound, and by push when no page is open. */

import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { allowDesktopNotices, chime } from "./notify.ts"
import { type PrefKey, type Prefs, choicesOf, prefsStore, setPref, usePrefs } from "./prefs.ts"
import { ts } from "./settings-copy.ts"
import { Choice, Group, Toggle } from "./settings-rows.tsx"
import { type PushState, disablePush, enablePush, pushState } from "./web-push.ts"

/** Web Push for when every page is closed; the browser decides whether it can, the bridge keeps the subscription. */
function PushToggle({ client }: { client: BridgeClient }) {
  const [state, setState] = useState<PushState | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    pushState(client).then(setState, () => setState("off"))
  }, [client])
  const flip = (next: boolean) => {
    setFailed(null)
    ;(next ? enablePush(client) : disablePush(client)).then(setState, (err: unknown) =>
      setFailed(err instanceof Error ? err.message : String(err)),
    )
  }
  const hint = failed
    ? t("prefs.pushFailed", { error: failed })
    : state === "unsupported"
      ? t("prefs.pushUnsupported")
      : state === "blocked"
        ? t("prefs.pushBlocked")
        : t("prefs.pushHint")
  return (
    <Toggle
      label={t("prefs.push")}
      hint={hint}
      checked={state === "on"}
      disabled={state === null || state === "unsupported" || state === "blocked"}
      onChange={flip}
    />
  )
}

export function NotificationsSection({ model }: { model: AppModel }) {
  const { client } = model
  const state = usePrefs()
  const { prefs } = state
  const set = <K extends PrefKey>(key: K, value: Prefs[K]) => void setPref(client, key, value)
  return (
    <Group>
      <Toggle
        label={ts("general.toast")}
        hint={t("settings.notifications.toastNote")}
        checked={prefs.toast}
        onChange={(next) => set("toast", next)}
      />
      <Toggle
        label={ts("general.sound")}
        hint={t("prefs.soundHint")}
        checked={prefs.sound}
        onChange={(next) => {
          if (next) allowDesktopNotices()
          set("sound", next)
        }}
      />
      <Choice
        label={t("settings.notifications.volume")}
        hint={t("prefs.soundVolumeHint")}
        value={prefs.soundVolume}
        picks={(choicesOf(state, "soundVolume") as number[]).map((value) => ({
          value,
          label: `${Math.round(value * 100)}%`,
        }))}
        onPick={(next) => {
          // Hearing the new level is how you pick it, as in the TUI.
          if (prefsStore.get().prefs.sound) chime(next)
          set("soundVolume", next)
        }}
      />
      <Toggle
        label={ts("general.crossTask")}
        hint={ts("general.crossTaskHint")}
        checked={prefs.crossTask}
        onChange={(next) => set("crossTask", next)}
      />
      <Toggle
        label={ts("general.finishedAlerts")}
        hint={ts("general.finishedAlertsHint")}
        checked={prefs.finishedAlerts}
        onChange={(next) => set("finishedAlerts", next)}
      />
      <PushToggle client={client} />
    </Group>
  )
}

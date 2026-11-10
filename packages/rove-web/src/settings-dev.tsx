/**
 * Settings → Dev: the three experimental flags, then restart the backend and reset UI state. Reset
 * and restart ask first, in the section itself, with the TUI's wording.
 */

import { useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { type PrefKey, type Prefs, setPref, usePrefs } from "./prefs.ts"
import { ts } from "./settings-copy.ts"
import { Group, Row, Toggle } from "./settings-rows.tsx"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { CONFIRM_INLINE, SETTINGS_ACTIONS } from "./ui/settings.ts"

const FLAGS: readonly { key: PrefKey; label: string; hint: string }[] = [
  { key: "remoteProjects", label: "dev.remote", hint: "dev.remoteHint" },
  { key: "autoStatus", label: "dev.autoStatus", hint: "dev.autoStatusHint" },
  { key: "dispatcher", label: "dev.dispatcher", hint: "dev.dispatcherHint" },
]

type Pending = "reset" | "restart" | null

export function DevSection({ client }: { client: BridgeClient }) {
  const { prefs } = usePrefs()
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      if (pending === "reset") {
        await client.request("dev.reset")
        // The page's cached prefs go with it; the reload reads the emptied state.json.
        localStorage.removeItem("rove.prefs")
        window.location.reload()
        return
      }
      await client.request("daemon.restart")
      toast(ts("restart.done"))
      setPending(null)
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }

  const ask = (kind: "reset" | "restart", title: string, hint: string, button: string, danger: boolean) => (
    <div>
      <Row label={title} hint={hint}>
        <Button variant="action" onClick={() => setPending(kind)}>
          {button}
        </Button>
      </Row>
      {pending === kind && (
        <div className="pb-3">
          <div className={CONFIRM_INLINE}>
            <strong>{ts(`${kind}.title`)}</strong>
            <p>{t(kind === "reset" ? "prefs.resetBody" : "prefs.restartBody")}</p>
            <div className={SETTINGS_ACTIONS}>
              <Button onClick={() => setPending(null)}>{t("dialog.cancel")}</Button>
              <Button variant={danger ? "danger" : "filled"} disabled={busy} onClick={() => void confirm()}>
                {button}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
      <Group title={ts("dev.experimental")}>
        {FLAGS.map((flag) => (
          <Toggle
            key={flag.key}
            label={ts(flag.label)}
            hint={ts(flag.hint)}
            checked={prefs[flag.key] as boolean}
            onChange={(next) => void setPref(client, flag.key, next as Prefs[typeof flag.key])}
          />
        ))}
      </Group>
      <Group hint={ts("dev.doctorHint")}>
        {ask("restart", ts("dev.restart"), t("prefs.restartHint"), t("prefs.restartButton"), false)}
        {ask("reset", ts("dev.reset"), t("prefs.resetHint"), t("prefs.resetButton"), true)}
      </Group>
    </>
  )
}

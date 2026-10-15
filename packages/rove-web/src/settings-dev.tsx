/**
 * Settings → Dev: reset UI state, restart the backend, and the three experimental flags. Reset
 * and restart ask first, in the section itself, with the TUI's wording.
 */

import { useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { type PrefKey, type Prefs, setPref, usePrefs } from "./prefs.ts"
import { ts } from "./settings-copy.ts"
import { Group, Toggle } from "./settings-rows.tsx"
import { toast } from "./ui.ts"

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
    <Group title={title} hint={hint}>
      {pending === kind ? (
        <div className="confirm-inline">
          <strong>{ts(`${kind}.title`)}</strong>
          <p className="muted">{kind === "reset" ? t("prefs.resetBody") : ts("restart.body")}</p>
          <div className="actions">
            <button type="button" className="link" onClick={() => setPending(null)}>
              {t("dialog.cancel")}
            </button>
            <button
              type="button"
              className={`button ${danger ? "is-danger" : ""}`}
              disabled={busy}
              onClick={() => void confirm()}
            >
              {button}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="pref-cycle" onClick={() => setPending(kind)}>
          <span className="pref-label">{button}</span>
        </button>
      )}
    </Group>
  )

  return (
    <>
      {ask("reset", ts("dev.reset"), t("prefs.resetHint"), t("prefs.resetButton"), true)}
      {ask("restart", ts("dev.restart"), ts("dev.restartHint"), t("prefs.restartButton"), false)}
      <p className="muted">{ts("dev.doctorHint")}</p>
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
    </>
  )
}

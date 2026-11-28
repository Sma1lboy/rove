/**
 * Settings → Connectors → Phone: a QR code that pairs a phone, so nobody has to read it off the terminal `rove --web`
 * started in. Each code carries its own device token, through Rove's end-to-end encrypted relay (`phone.pair`).
 */

import { useState } from "react"
import { renderSVG } from "uqr"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import {
  BENTO,
  CARD_HEAD,
  CARD_HEAD_TITLE,
  SETTINGS_GROUP_HINT,
  SETTINGS_GROUP_LABEL,
  SETTINGS_NAME,
  SETTINGS_NOTE,
  bentoCardClass,
} from "./ui/settings.ts"

const c = (key: string, params?: Record<string, string | number>): string => t(`settings.connectors.${key}`, params)

interface Pairing {
  readonly link: string
  readonly device: string
}

export function PhoneConnector({ model }: { model: AppModel }) {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [busy, setBusy] = useState(false)
  const show = async () => {
    setBusy(true)
    try {
      setPairing(await model.client.request<Pairing>("phone.pair"))
    } catch (err) {
      toast(c("phoneFailed", { error: errorText(err) }), "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="flex flex-col pt-4">
      <h2 className={SETTINGS_GROUP_LABEL}>{c("phone")}</h2>
      <p className={SETTINGS_GROUP_HINT}>{c("phoneHint")}</p>
      <div className={BENTO}>
        <div className={bentoCardClass(true)}>
          <div className={CARD_HEAD}>
            <span className={CARD_HEAD_TITLE}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={SETTINGS_NAME}>{c("phoneTitle")}</span>
                <span className={SETTINGS_NOTE}>{c("phoneNote")}</span>
              </span>
            </span>
            {pairing ? (
              <Button onClick={() => setPairing(null)}>{c("phoneHide")}</Button>
            ) : (
              <Button variant="filled" disabled={busy} onClick={() => void show()}>
                {c("phoneShow")}
              </Button>
            )}
          </div>
          {pairing && (
            <div className="flex flex-wrap items-start gap-4">
              {/* Black on white whatever the theme: a camera reads a dark-on-light code best. */}
              <img
                className="size-48 flex-none rounded-sm bg-white p-2"
                alt={c("phoneQrAlt")}
                src={`data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(pairing.link, { blackColor: "#000", whiteColor: "#fff" }))}`}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2 text-meta text-muted">
                <p>{c("phoneSecret")}</p>
                <p>{c("phoneDevice", { device: pairing.device })}</p>
                <code className="select-all break-all">rove --web --revoke-device {pairing.device}</code>
                <div>
                  <Button
                    onClick={() =>
                      navigator.clipboard.writeText(pairing.link).then(
                        () => toast(c("phoneCopied")),
                        () => {},
                      )
                    }
                  >
                    {c("phoneCopy")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

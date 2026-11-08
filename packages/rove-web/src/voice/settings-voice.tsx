/**
 * Settings → Voice: which recognizer dictation uses on this host, installing the local one, and saving a cloud
 * endpoint. The bridge does the work (`voice.install`, `voice.configure`) and reports it through `voice.status`,
 * which this polls while an install runs or a sidecar warms up. The page never holds the API key: a saved one
 * shows as "saved", and an empty field keeps it.
 */

import { useCallback, useEffect, useState } from "react"
import type { BridgeClient } from "../bridge.ts"
import { errorText } from "../dialogs.tsx"
import { t } from "../i18n/index.ts"
import { Group, Row } from "../settings-rows.tsx"
import { Button } from "../ui/button.tsx"
import {
  SETTINGS_ACTIONS,
  SETTINGS_FIELD,
  SETTINGS_FIELD_LABEL,
  SETTINGS_INPUT,
  SETTINGS_STATUS,
  SETTINGS_VALUE,
} from "../ui/settings.ts"
import { setVoiceAvailable } from "./dictation-button.tsx"

const POLL_MS = 2000

interface VoiceStatus {
  readonly up: boolean
  readonly ready: boolean
  readonly model: string | null
  readonly error: string | null
  readonly available: boolean
  readonly setup?: {
    readonly localInstalled: boolean
    readonly install: { readonly phase: "idle" | "running" | "done" | "failed"; readonly line: string | null }
    readonly backend: "local" | "cloud"
    readonly cloud: { readonly baseURL: string; readonly model: string; readonly hasKey: boolean } | null
    readonly blocked: string | null
  }
}

function useVoiceStatus(client: BridgeClient) {
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const accept = useCallback(
    (next: VoiceStatus) => {
      setStatus(next)
      setVoiceAvailable(client, next.available)
    },
    [client],
  )
  const refresh = useCallback(
    () => client.request<VoiceStatus>("voice.status").then(accept, (err) => setError(errorText(err))),
    [client, accept],
  )
  useEffect(() => void refresh(), [refresh])
  // Watch while something is moving: a download, or a sidecar that is set up but not ready yet.
  const moving = status?.setup?.install.phase === "running" || (status?.available === true && !status.ready)
  useEffect(() => {
    if (!moving) return
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [moving, refresh])
  return { status, error, setError, accept }
}

export function VoiceSection({ client }: { client: BridgeClient }) {
  const { status, error, setError, accept } = useVoiceStatus(client)
  const [busy, setBusy] = useState(false)
  const setup = status?.setup
  const [baseURL, setBaseURL] = useState("")
  const [model, setModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  // The saved endpoint fills the form once it is known; typing after that is the user's.
  useEffect(() => {
    if (!setup?.cloud) return
    setBaseURL((now) => now || setup.cloud?.baseURL || "")
    setModel((now) => now || setup.cloud?.model || "")
  }, [setup?.cloud])

  const act = (op: string, args?: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    client
      .request<VoiceStatus>(op, args)
      .then(accept, (err) => setError(errorText(err)))
      .finally(() => setBusy(false))
  }

  if (!status) return <p className={SETTINGS_STATUS}>{error ?? "…"}</p>
  if (!setup) return <p className={SETTINGS_STATUS}>{status.model ?? t("voice.setup.off")}</p>

  const name = status.model ?? ""
  // Off: the reason reads as the row's note, where it wraps; a short state sits on the right.
  const recognizer = status.ready
    ? t("voice.setup.ready", { model: name })
    : status.available
      ? (status.error ?? t("voice.setup.starting", { model: name || setup.backend }))
      : null
  const install = setup.install
  const local = setup.backend === "local"
  return (
    <>
      <Group>
        <Row label={t("voice.setup.recognizer")} hint={recognizer === null ? t("voice.setup.off") : undefined}>
          {recognizer !== null && <span className={SETTINGS_VALUE}>{recognizer}</span>}
        </Row>
      </Group>
      <Group>
        <Row
          label={t("voice.setup.localTitle")}
          hint={
            install.phase === "running"
              ? (install.line ?? t("voice.setup.installing"))
              : install.phase === "failed"
                ? t("voice.setup.failed", { line: install.line ?? "" })
                : setup.localInstalled
                  ? t("voice.setup.installed")
                  : (setup.blocked ?? t("voice.setup.localHint"))
          }
        >
          {install.phase === "running" ? (
            <span className={SETTINGS_VALUE}>{t("voice.setup.installing")}</span>
          ) : !setup.localInstalled ? (
            !setup.blocked && (
              <Button variant="action" disabled={busy} onClick={() => act("voice.install")}>
                {t("voice.setup.install")}
              </Button>
            )
          ) : local ? (
            <span className={SETTINGS_VALUE}>{t("voice.setup.inUse")}</span>
          ) : (
            <Button variant="action" disabled={busy} onClick={() => act("voice.configure", { backend: "local" })}>
              {t("voice.setup.use")}
            </Button>
          )}
        </Row>
      </Group>
      <Group title={t("voice.setup.cloudTitle")} hint={t("voice.setup.cloudHint")}>
        <form
          className="flex flex-col gap-3 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            act("voice.configure", { backend: "cloud", baseURL, model, apiKey })
            setApiKey("")
          }}
        >
          <label className={SETTINGS_FIELD}>
            <span className={SETTINGS_FIELD_LABEL}>{t("voice.setup.baseURL")}</span>
            <input
              className={`${SETTINGS_INPUT} font-mono`}
              value={baseURL}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setBaseURL(e.target.value)}
            />
          </label>
          <label className={SETTINGS_FIELD}>
            <span className={SETTINGS_FIELD_LABEL}>{t("voice.setup.model")}</span>
            <input
              className={`${SETTINGS_INPUT} font-mono`}
              value={model}
              placeholder="gpt-4o-mini-transcribe"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <label className={SETTINGS_FIELD}>
            <span className={SETTINGS_FIELD_LABEL}>{t("voice.setup.apiKey")}</span>
            <input
              className={`${SETTINGS_INPUT} font-mono`}
              type="password"
              value={apiKey}
              placeholder={setup.cloud?.hasKey ? t("voice.setup.keySaved") : ""}
              autoComplete="off"
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <div className={SETTINGS_ACTIONS}>
            {!local && <span className={SETTINGS_VALUE}>{t("voice.setup.inUse")}</span>}
            <Button
              variant="action"
              type="submit"
              disabled={busy || !baseURL.trim() || !model.trim() || !(apiKey || setup.cloud?.hasKey)}
            >
              {t("voice.setup.save")}
            </Button>
          </div>
        </form>
      </Group>
      {error && <p className={`${SETTINGS_STATUS} text-error`}>{error}</p>}
    </>
  )
}

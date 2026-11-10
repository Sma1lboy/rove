/**
 * Settings → Voice: one choice of where dictation is recognized (off, on this Mac, a cloud endpoint), then only
 * what that choice needs: the local model to install or remove, or the endpoint to save or forget. The bridge
 * does the work (`voice.configure`, `voice.install`, `voice.uninstall`, `voice.forgetCloud`) and reports it
 * through `voice.status`, which this polls while an install runs or a sidecar warms up. The page never holds
 * the API key: a saved one shows as "saved", and an empty field keeps it.
 */

import { useCallback, useEffect, useState } from "react"
import type { BridgeClient } from "../bridge.ts"
import { errorText } from "../dialogs.tsx"
import { t } from "../i18n/index.ts"
import { Choice, Group, Row } from "../settings-rows.tsx"
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

type Backend = "off" | "local" | "cloud"

interface VoiceStatus {
  readonly up: boolean
  readonly ready: boolean
  readonly model: string | null
  readonly error: string | null
  readonly available: boolean
  readonly setup?: {
    readonly localInstalled: boolean
    readonly install: { readonly phase: "idle" | "running" | "done" | "failed"; readonly line: string | null }
    readonly backend: Backend
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

/** A button that asks once more in place before it removes something. */
function RemoveButton(props: { label: string; ask: string; disabled: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <Button variant="action" disabled={props.disabled} onClick={() => setAsking(true)}>
        {props.label}
      </Button>
    )
  }
  return (
    <>
      <span className={SETTINGS_VALUE}>{props.ask}</span>
      <Button
        variant="action"
        disabled={props.disabled}
        onClick={() => {
          setAsking(false)
          props.onConfirm()
        }}
      >
        {props.label}
      </Button>
      <Button variant="action" onClick={() => setAsking(false)}>
        {t("voice.setup.cancel")}
      </Button>
    </>
  )
}

export function VoiceSection({ client }: { client: BridgeClient }) {
  const { status, error, setError, accept } = useVoiceStatus(client)
  const [busy, setBusy] = useState(false)
  const setup = status?.setup
  // Cloud picked with no endpoint saved yet: the choice takes effect once one is.
  const [fillingCloud, setFillingCloud] = useState(false)
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
    return client
      .request<VoiceStatus>(op, args)
      .then(accept, (err) => setError(errorText(err)))
      .finally(() => setBusy(false))
  }

  if (!status) return <p className={SETTINGS_STATUS}>{error ?? "…"}</p>
  if (!setup) return <p className={SETTINGS_STATUS}>{status.model ?? t("voice.setup.unavailable")}</p>

  const install = setup.install
  const installing = install.phase === "running"
  const shown: Backend = fillingCloud ? "cloud" : setup.backend
  const pick = (next: Backend) => {
    if (next === "cloud" && !setup.cloud?.hasKey) return setFillingCloud(true)
    setFillingCloud(false)
    void act("voice.configure", { backend: next })
  }
  // What the choice amounts to right now, in the words under it.
  const state =
    shown === "off"
      ? t("voice.setup.offHint")
      : fillingCloud
        ? t("voice.setup.cloudNeeded")
        : shown === "local" && !setup.localInstalled
          ? t(installing ? "voice.setup.localInstalling" : "voice.setup.localNeeded")
          : status.ready
            ? t("voice.setup.ready", { model: status.model ?? "" })
            : (status.error ?? t("voice.setup.starting"))
  const localState = installing
    ? (install.line ?? t("voice.setup.installing"))
    : install.phase === "failed" && !setup.localInstalled
      ? t("voice.setup.failed", { line: install.line ?? "" })
      : setup.localInstalled
        ? t("voice.setup.installed")
        : (setup.blocked ?? t("voice.setup.localHint"))
  return (
    <>
      <Group>
        <Choice
          label={t("voice.setup.dictation")}
          hint={state}
          value={shown}
          picks={(["off", "local", "cloud"] as const).map((value) => ({
            value,
            label: t(`voice.setup.backend.${value}`),
          }))}
          onPick={pick}
        />
      </Group>
      {(shown === "local" || setup.localInstalled || installing) && (
        <Group title={t("voice.setup.backend.local")}>
          <Row label={t("voice.setup.localTitle")} hint={localState}>
            {installing ? (
              <span className={SETTINGS_VALUE}>{t("voice.setup.installing")}</span>
            ) : setup.localInstalled ? (
              <RemoveButton
                label={t("voice.setup.uninstall")}
                ask={t("voice.setup.uninstallAsk")}
                disabled={busy}
                onConfirm={() => void act("voice.uninstall")}
              />
            ) : (
              !setup.blocked && (
                <Button variant="action" disabled={busy} onClick={() => void act("voice.install")}>
                  {t("voice.setup.install")}
                </Button>
              )
            )}
          </Row>
        </Group>
      )}
      {(shown === "cloud" || setup.cloud) && (
        <Group title={t("voice.setup.cloudTitle")} hint={t("voice.setup.cloudHint")}>
          <form
            className="flex flex-col gap-3 py-3"
            onSubmit={(e) => {
              e.preventDefault()
              void act("voice.configure", { backend: "cloud", baseURL, model, apiKey }).then(() =>
                setFillingCloud(false),
              )
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
              {setup.cloud && (
                <RemoveButton
                  label={t("voice.setup.forget")}
                  ask={t("voice.setup.forgetAsk")}
                  disabled={busy}
                  onConfirm={() => {
                    setBaseURL("")
                    setModel("")
                    void act("voice.forgetCloud")
                  }}
                />
              )}
              <Button
                variant="action"
                type="submit"
                disabled={busy || !baseURL.trim() || !model.trim() || !(apiKey || setup.cloud?.hasKey)}
              >
                {t(setup.backend === "cloud" ? "voice.setup.save" : "voice.setup.saveAndUse")}
              </Button>
            </div>
          </form>
        </Group>
      )}
      {error && <p className={`${SETTINGS_STATUS} text-error`}>{error}</p>}
    </>
  )
}

/**
 * Settings → Engines: one row per engine (name, a plain-language status, whether it is the
 * default, whether it is offered), the detection facts and rename/reset in a detail area that
 * opens under its row, and one section for Rove's engine integrations (the activity hooks).
 * Launch commands stay a Mac-side edit.
 */

import { type EngineHealthTone, engineHealth } from "@sma1lboy/rove/src/engine/engine-health.ts"
import { useCallback, useEffect, useId, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { ts } from "./settings-copy.ts"
import { toast } from "./ui.ts"

/** `engines.settings` row, trimmed to what the page shows. */
interface EngineSetting {
  readonly id: string
  readonly name: string
  readonly custom: boolean
  readonly enabled: boolean
  readonly isDefault: boolean
  readonly canBeDefault: boolean
  readonly binary: string
  readonly customized: boolean
  /** The registry's name when the user renamed the engine. */
  readonly renamedFrom?: string | null
  readonly protocol?: string | null
  readonly binaryFound: boolean | null
  readonly binaryPath?: string | null
  readonly login: "yes" | "no" | "unknown"
  readonly hooks: "installed" | "outdated" | "not-installed" | "unsupported"
  readonly markers: boolean
  readonly screen: boolean
  readonly configIssue?: string
}

type Run = (op: string, args?: Record<string, unknown>) => void

function health(e: EngineSetting) {
  return engineHealth({
    binaryFound: e.binaryFound,
    login: e.login,
    hooks: e.hooks,
    configIssue: e.configIssue,
    commandChosen: e.custom || e.customized,
  })
}

const TONE_CLASS: Record<EngineHealthTone, string> = {
  ready: "is-ready",
  attention: "is-attention",
  error: "is-error",
  absent: "is-absent",
  unknown: "is-absent",
}

export function EnginesSection({ client }: { client: BridgeClient }) {
  const [engines, setEngines] = useState<readonly EngineSetting[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(
    () =>
      client.request<{ engines: EngineSetting[] }>("engines.settings").then(
        (r) => setEngines(r.engines),
        (e) => toast(errorText(e), "error"),
      ),
    [client],
  )
  useEffect(() => {
    void load()
  }, [load])
  const run: Run = (op, args = {}) =>
    void client
      .request(op, args)
      .then(load)
      .catch((e) => toast(errorText(e), "error"))
  if (!engines) return <p className="placeholder-line">{t("preview.loading")}</p>
  return (
    <section className="settings-group engines">
      <p className="muted">{ts("engines.hint")}</p>
      <div className="eng-list">
        <div className="eng-list-head" aria-hidden="true">
          <span>{ts("sections.engines")}</span>
          <span>{ts("engines.defaultMark")}</span>
          <span>{ts("engines.available")}</span>
        </div>
        {engines.map((e) => (
          <EngineItem
            key={e.id}
            engine={e}
            open={open === e.id}
            onToggleOpen={() => setOpen(open === e.id ? null : e.id)}
            run={run}
          />
        ))}
      </div>
      <Integrations engines={engines} run={run} />
    </section>
  )
}

function EngineItem(props: { engine: EngineSetting; open: boolean; onToggleOpen: () => void; run: Run }) {
  const { engine: e, run } = props
  const detailId = useId()
  const status = health(e)
  return (
    <div className={`eng-item ${props.open ? "is-open" : ""} ${e.enabled ? "" : "is-off"}`}>
      <div className="eng-row">
        <button
          type="button"
          className="eng-summary"
          aria-expanded={props.open}
          aria-controls={detailId}
          onClick={props.onToggleOpen}
        >
          <svg className="eng-chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="eng-title">
            <span className="eng-name">
              {e.name}
              {e.renamedFrom ? <span className="eng-sub">{e.renamedFrom}</span> : null}
              {e.custom && !e.renamedFrom ? <span className="eng-sub">{ts("engines.customTag")}</span> : null}
            </span>
            <span className={`eng-status ${TONE_CLASS[status.tone]}`}>
              <span className="eng-dot" aria-hidden="true" />
              {ts(status.key.slice("settings.".length))}
            </span>
          </span>
        </button>
        <div className="eng-default">
          {e.isDefault ? (
            <span className="eng-pill">{ts("engines.defaultMark")}</span>
          ) : e.canBeDefault ? (
            <button
              type="button"
              className="eng-make-default"
              aria-label={t("settings.engines.default", { name: e.name })}
              onClick={() => run("engine.setDefault", { id: e.id })}
            >
              {ts("engines.makeDefault")}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={e.enabled}
          aria-label={t("settings.engines.enabled", { name: e.name })}
          className="switch"
          onClick={() => run("engine.setEnabled", { id: e.id, enabled: !e.enabled })}
        >
          <span className="switch-knob" />
        </button>
      </div>
      {props.open ? <EngineDetail id={detailId} engine={e} run={run} /> : null}
    </div>
  )
}

function hooksSentence(e: EngineSetting): string {
  if (e.configIssue) return ts("engines.detail.hooksBlockedHere", { reason: e.configIssue })
  switch (e.hooks) {
    case "installed":
      return ts("engines.detail.hooksInstalled")
    case "outdated":
      return ts("engines.detail.hooksOutdated")
    case "not-installed":
      return e.binaryFound === false ? ts("engines.detail.hooksAwaitEngine") : ts("engines.detail.hooksMissing")
    default:
      return ts("engines.detail.hooksUnsupported")
  }
}

function EngineDetail(props: { id: string; engine: EngineSetting; run: Run }) {
  const { engine: e, run } = props
  const [renaming, setRenaming] = useState<string | null>(null)
  const program =
    e.binaryFound === true
      ? ts("engines.detail.programFound", { binary: e.binary, path: e.binaryPath ?? e.binary })
      : e.binaryFound === false
        ? ts("engines.detail.programMissing", { binary: e.binary })
        : ts("engines.detail.programUnknown", { binary: e.binary })
  const signIn =
    e.login === "yes"
      ? ts("engines.detail.signedIn")
      : e.login === "no"
        ? ts("engines.detail.signedOut")
        : ts("engines.detail.signInUnknown")
  const reporting = [
    hooksSentence(e),
    ts(e.markers ? "engines.detail.markersYes" : "engines.detail.markersNo"),
    ts(
      e.screen
        ? "engines.detail.screenYes"
        : e.hooks === "installed"
          ? "engines.detail.screenNotNeeded"
          : "engines.detail.screenNo",
    ),
  ]
  return (
    <div id={props.id} className="eng-detail-area">
      <dl className="eng-facts">
        <dt>{ts("engines.detail.program")}</dt>
        <dd className={e.binaryFound === false ? "tone-warning" : ""}>{program}</dd>
        <dt>{ts("engines.detail.signIn")}</dt>
        <dd className={e.login === "no" ? "tone-warning" : ""}>{signIn}</dd>
        <dt>{ts("engines.detail.reporting")}</dt>
        <dd>
          {reporting.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </dd>
        {e.custom ? (
          <>
            <dt>{ts("engines.detail.adapter")}</dt>
            <dd>
              {e.protocol
                ? ts("engines.detail.adapterDeclared", { protocol: e.protocol })
                : ts("engines.detail.adapterGeneric")}
            </dd>
          </>
        ) : null}
      </dl>
      {renaming !== null ? (
        <form
          className="eng-rename"
          onSubmit={(ev) => {
            ev.preventDefault()
            run("engine.rename", { id: e.id, name: renaming })
            setRenaming(null)
          }}
        >
          <input
            className="input"
            // biome-ignore lint/a11y/noAutofocus: the rename field just opened
            autoFocus
            value={renaming}
            aria-label={t("settings.engines.rename")}
            placeholder={t("settings.engines.namePlaceholder")}
            onChange={(ev) => setRenaming(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Escape") {
                ev.stopPropagation()
                setRenaming(null)
              }
            }}
          />
          <button type="submit" className="button">
            {t("settings.engines.save")}
          </button>
          <button type="button" className="eng-action" onClick={() => setRenaming(null)}>
            {t("settings.engines.cancel")}
          </button>
        </form>
      ) : (
        <div className="eng-actions">
          <button type="button" className="eng-action" onClick={() => setRenaming(e.name)}>
            {t("settings.engines.rename")}
          </button>
          {e.custom || e.customized ? (
            <button type="button" className="eng-action" onClick={() => run("engine.reset", { id: e.id })}>
              {e.custom ? t("settings.engines.remove") : t("settings.engines.reset")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Integrations({ engines, run }: { engines: readonly EngineSetting[]; run: Run }) {
  const hooked = engines.filter((e) => e.hooks !== "unsupported")
  // An engine whose CLI is not on this machine has nothing to install into.
  const hookable = hooked.filter((e) => e.binaryFound !== false)
  const current = hookable.filter((e) => e.hooks === "installed").length
  const needInstall = hookable.length - current
  const onDisk = hooked.filter((e) => e.hooks !== "not-installed").length
  if (hooked.length === 0) return null
  return (
    <div className="eng-integrations">
      <div className="eng-integrations-head">
        <h3>{ts("engines.integrations.title")}</h3>
        <span className="muted">
          {ts("engines.integrations.summary", { installed: current, total: hookable.length })}
        </span>
      </div>
      <p className="muted">{ts("engines.integrations.hint")}</p>
      <div className="eng-integrations-actions">
        {needInstall > 0 ? (
          <button type="button" className="button" onClick={() => run("engines.hooks.install")}>
            {ts("engines.integrations.install", { count: needInstall })}
          </button>
        ) : (
          <span className="eng-uptodate">{ts("engines.integrations.upToDate")}</span>
        )}
        {onDisk > 0 ? (
          <button type="button" className="eng-action" onClick={() => run("engines.hooks.uninstall")}>
            {ts("engines.integrations.remove", { count: onDisk })}
          </button>
        ) : null}
      </div>
    </div>
  )
}

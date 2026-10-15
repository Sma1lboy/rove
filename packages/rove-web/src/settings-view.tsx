/**
 * Settings, as the TUI's settings dialog: a section list on the left (General, Engines,
 * Plugins, Feedback) and the section on the right. Every write is a bridge op on the
 * same state.json keys the TUI writes, so both surfaces read the same settings.
 */

import { useCallback, useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { DialogShell, errorText } from "./dialogs.tsx"
import { LOCALE_KEY, type Locale, locale, t, useLocale } from "./i18n/index.ts"
import { useStore } from "./store.ts"
import { toast } from "./ui.ts"

type Section = "general" | "engines" | "plugins" | "feedback"
const SECTIONS: readonly Section[] = ["general", "engines", "plugins", "feedback"]

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
  readonly binaryFound: boolean
  readonly binaryPath?: string | null
  readonly login: "yes" | "no" | "unknown" | string
}

interface PluginRow {
  readonly id: string
  readonly name?: string
  readonly enabled: boolean
  readonly description?: string
}

export function SettingsDialog({ client }: { client: BridgeClient }) {
  useLocale()
  const [section, setSection] = useState<Section>("general")
  return (
    <DialogShell title={t("settings.title")} wide>
      <div className="settings">
        <nav className="settings-nav" aria-label={t("settings.title")}>
          {SECTIONS.map((id) => (
            <button
              type="button"
              key={id}
              className={`settings-tab ${section === id ? "is-active" : ""}`}
              onClick={() => setSection(id)}
            >
              {t(`settings.sections.${id}`)}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {section === "general" && <General client={client} />}
          {section === "engines" && <Engines client={client} />}
          {section === "plugins" && <Plugins client={client} />}
          {section === "feedback" && <Feedback client={client} />}
        </div>
      </div>
    </DialogShell>
  )
}

const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "zh", label: "中文" },
]

function General({ client }: { client: BridgeClient }) {
  const current = useStore(locale)
  const [info, setInfo] = useState<{ daemonVersion?: string; stale?: boolean; uptimeMs?: number } | null>(null)
  useEffect(() => {
    void client.request<typeof info>("daemon.info").then(setInfo, () => setInfo(null))
  }, [client])
  return (
    <>
      <section className="settings-group">
        <h2 className="kicker">{t("settings.general.language")}</h2>
        <p className="muted">{t("settings.general.languageHint")}</p>
        <div className="chips-row">
          {LOCALES.map((l) => (
            <button
              type="button"
              key={l.id}
              aria-pressed={current === l.id}
              className={`chip-button ${current === l.id ? "is-active" : ""}`}
              onClick={() => {
                locale.set(l.id)
                localStorage.setItem(LOCALE_KEY, l.id)
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>
      {info?.daemonVersion && (
        <section className="settings-group">
          <h2 className="kicker">{t("settings.general.daemon")}</h2>
          <p className={`mono ${info.stale ? "tone-warning" : "muted"}`}>
            {t(info.stale ? "settings.general.daemonStale" : "settings.general.daemonCurrent", {
              version: info.daemonVersion,
            })}
          </p>
        </section>
      )}
    </>
  )
}

function Engines({ client }: { client: BridgeClient }) {
  const [engines, setEngines] = useState<readonly EngineSetting[] | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
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
  const run = (op: string, args: Record<string, unknown>) =>
    void client
      .request(op, args)
      .then(load)
      .catch((e) => toast(errorText(e), "error"))
  if (!engines) return <p className="placeholder-line">{t("preview.loading")}</p>
  return (
    <section className="settings-group">
      <p className="muted">{t("settings.engines.hint")}</p>
      <div className="settings-rows">
        {engines.map((e) => (
          <div key={e.id} className="engine-row">
            <label className="engine-check">
              <input
                type="checkbox"
                checked={e.enabled}
                aria-label={t("settings.engines.enabled", { name: e.name })}
                onChange={() => run("engine.setEnabled", { id: e.id, enabled: !e.enabled })}
              />
            </label>
            <label className="engine-check">
              <input
                type="radio"
                name="default-engine"
                checked={e.isDefault}
                disabled={!e.canBeDefault}
                aria-label={t("settings.engines.default", { name: e.name })}
                onChange={() => run("engine.setDefault", { id: e.id })}
              />
            </label>
            <div className="engine-main">
              {renaming?.id === e.id ? (
                <form
                  onSubmit={(ev) => {
                    ev.preventDefault()
                    run("engine.rename", { id: e.id, name: renaming.value })
                    setRenaming(null)
                  }}
                >
                  <input
                    className="input"
                    // biome-ignore lint/a11y/noAutofocus: the rename field just opened
                    autoFocus
                    value={renaming.value}
                    placeholder={t("settings.engines.namePlaceholder")}
                    onChange={(ev) => setRenaming({ id: e.id, value: ev.target.value })}
                    onKeyDown={(ev) => {
                      if (ev.key === "Escape") {
                        ev.stopPropagation()
                        setRenaming(null)
                      }
                    }}
                  />
                </form>
              ) : (
                <span className="engine-name">
                  {e.name}
                  {e.custom && <span className="muted">{t("settings.engines.customTag")}</span>}
                </span>
              )}
              <span className="mono muted engine-detail">
                {e.binaryFound ? (e.binaryPath ?? e.binary) : t("settings.engines.binaryMissing", { binary: e.binary })}
                {" · "}
                {e.login === "yes"
                  ? t("settings.engines.loginReady")
                  : e.login === "no"
                    ? t("settings.engines.loginMissing")
                    : t("settings.engines.loginUnknown")}
              </span>
            </div>
            <div className="engine-actions">
              <button type="button" className="link" onClick={() => setRenaming({ id: e.id, value: e.name })}>
                {t("settings.engines.rename")}
              </button>
              {(e.custom || e.customized) && (
                <button type="button" className="link" onClick={() => run("engine.reset", { id: e.id })}>
                  {e.custom ? t("settings.engines.remove") : t("settings.engines.reset")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Plugins({ client }: { client: BridgeClient }) {
  const [plugins, setPlugins] = useState<readonly PluginRow[] | null>(null)
  const load = useCallback(
    () =>
      client.request<{ plugins: PluginRow[] }>("plugins.list").then(
        (r) => setPlugins(r.plugins),
        (e) => toast(errorText(e), "error"),
      ),
    [client],
  )
  useEffect(() => {
    void load()
  }, [load])
  if (!plugins) return <p className="placeholder-line">{t("preview.loading")}</p>
  if (plugins.length === 0) return <p className="placeholder-line">{t("settings.plugins.empty")}</p>
  return (
    <div className="settings-rows">
      {plugins.map((p) => (
        <label key={p.id} className="engine-row">
          <input
            type="checkbox"
            checked={p.enabled}
            onChange={() =>
              void client
                .request("plugin.setEnabled", { id: p.id, enabled: !p.enabled })
                .then(load)
                .catch((e) => toast(errorText(e), "error"))
            }
          />
          <div className="engine-main">
            <span className="engine-name">{p.name ?? p.id}</span>
            {p.description && <span className="muted engine-detail">{p.description}</span>}
          </div>
        </label>
      ))}
    </div>
  )
}

function Feedback({ client }: { client: BridgeClient }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="settings-group"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim() || !body.trim()) return
        setBusy(true)
        void client
          .request<{ url?: string }>("feedback.send", { title: title.trim(), body })
          .then((r) => {
            toast(t("settings.feedback.sent", { url: r.url ?? "" }))
            setTitle("")
            setBody("")
          })
          .catch((err) => toast(errorText(err), "error"))
          .finally(() => setBusy(false))
      }}
    >
      <p className="muted">{t("settings.feedback.hint")}</p>
      <label className="field">
        <span className="kicker">{t("settings.feedback.titleLabel")}</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="kicker">{t("settings.feedback.body")}</span>
        <textarea className="input textarea" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="actions">
        <button type="submit" className="button" disabled={busy || !title.trim() || !body.trim()}>
          {t("settings.feedback.send")}
        </button>
      </div>
    </form>
  )
}

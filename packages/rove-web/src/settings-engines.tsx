/**
 * Settings → Engines: every engine with what detection found, on/off, the default, rename,
 * reset or remove, the third card line (which of Rove's reporting layers it uses), and the
 * install / remove rows for Rove's activity hooks. Launch commands stay a Mac-side edit.
 */

import { useCallback, useEffect, useState } from "react"
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
  readonly binaryFound: boolean | null
  readonly binaryPath?: string | null
  readonly login: "yes" | "no" | "unknown" | string
  readonly hooks: "installed" | "outdated" | "not-installed" | "unsupported" | string
  readonly markers: boolean
  readonly screen: boolean
  readonly configIssue?: string
}

/** The TUI's copy and warn flag per hook state (`sections-engines-integration.tsx`). */
const HOOK_STATES: Readonly<Record<string, { key: string; warn: boolean }>> = {
  installed: { key: "engines.hookInstalled", warn: false },
  outdated: { key: "engines.hookOutdated", warn: true },
  "not-installed": { key: "engines.hookMissing", warn: true },
}

function IntegrationLine({ engine }: { engine: EngineSetting }) {
  const supported = engine.hooks !== "unsupported"
  // A missing hook on an engine whose CLI is not here is not a fault.
  const absent = supported && engine.hooks === "not-installed" && engine.binaryFound === false
  const hook = supported && !absent ? HOOK_STATES[engine.hooks] : undefined
  const label = hook ? ts(hook.key) : absent ? ts("engines.hookUnavailable") : ts("engines.hookNone")
  return (
    <span className="engine-detail mono">
      <span className={hook ? (hook.warn ? "tone-warning" : "tone-success") : "muted"}>{label}</span>
      {" · "}
      <span className={engine.markers ? "" : "muted"}>
        {ts(engine.markers ? "engines.markersYes" : "engines.markersNo")}
      </span>
      {" · "}
      <span className={engine.screen ? "" : "muted"}>
        {ts(engine.screen ? "engines.screenYes" : "engines.screenNo")}
      </span>
      {engine.configIssue && <span className="tone-attention"> · ! {engine.configIssue}</span>}
    </span>
  )
}

export function EnginesSection({ client }: { client: BridgeClient }) {
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
  const run = (op: string, args: Record<string, unknown> = {}) =>
    void client
      .request(op, args)
      .then(load)
      .catch((e) => toast(errorText(e), "error"))
  if (!engines) return <p className="placeholder-line">{t("preview.loading")}</p>
  const hooked = engines.filter((e) => e.hooks !== "unsupported")
  const needInstall = hooked.filter((e) => e.hooks !== "installed").length
  const installed = hooked.filter((e) => e.hooks !== "not-installed").length
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
                  {e.custom && <span className="muted">{ts("engines.customTag")}</span>}
                </span>
              )}
              <span className="mono muted engine-detail">
                {e.binaryFound === false
                  ? t("settings.engines.binaryMissing", { binary: e.binary })
                  : (e.binaryPath ?? e.binary)}
                {" · "}
                {e.login === "yes"
                  ? t("settings.engines.loginReady")
                  : e.login === "no"
                    ? t("settings.engines.loginMissing")
                    : t("settings.engines.loginUnknown")}
              </span>
              <IntegrationLine engine={e} />
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
      <div className="hook-rows">
        <button type="button" className="link" onClick={() => run("engines.hooks.install")}>
          {needInstall > 0 ? ts("engines.installHooks", { count: needInstall }) : ts("engines.installHooksDone")}
        </button>
        <button type="button" className="link" onClick={() => run("engines.hooks.uninstall")}>
          {installed > 0 ? ts("engines.uninstallHooks", { count: installed }) : ts("engines.uninstallHooksDone")}
        </button>
      </div>
    </section>
  )
}

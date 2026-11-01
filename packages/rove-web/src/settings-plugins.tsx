/**
 * Settings → Plugins: the first-party mods (Kanban, Issues) with Install / Uninstall, then the
 * registry with an on/off switch each. Manifest settings and the marketplace stay Mac-side.
 */

import { useCallback, useEffect, useState } from "react"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { useStore } from "./store.ts"
import { type PageId, page, toast } from "./ui.ts"
import { MONO, PLACEHOLDER_LINE } from "./ui/text.ts"

interface PluginRow {
  readonly id: string
  readonly version?: string
  readonly enabled: boolean
  readonly linked?: boolean
  readonly platformOk?: boolean
}

interface ModRow {
  readonly id: string
  readonly name: string
  readonly description: string
}

/** The page each first-party mod owns, closed when the mod is uninstalled under it. */
const MOD_PAGE: Readonly<Record<string, PageId>> = { kanban: "kanban", issues: "issues" }

function BuiltinMods({ model }: { model: AppModel }) {
  const installed = useStore(model.installedMods)
  const [mods, setMods] = useState<readonly ModRow[] | null>(
    () => lastReply<{ mods: ModRow[] }>(model, "builtinMods.list")?.mods ?? null,
  )
  useEffect(() => {
    void requestRemembered<{ mods: ModRow[] }>(model, "builtinMods.list").then(
      (r) => setMods(r.mods),
      () => setMods([]),
    )
    void model.refreshMods()
  }, [model])
  if (!mods || mods.length === 0) return null
  const flip = (mod: ModRow) => {
    const next = !installed.has(mod.id)
    void model.client
      .request("builtinMod.setInstalled", { id: mod.id, installed: next })
      .then(() => {
        if (!next && page.get() === MOD_PAGE[mod.id]) page.set(null)
        return model.refreshMods()
      })
      .catch((e) => toast(errorText(e), "error"))
  }
  return (
    <div className="settings-rows">
      {mods.map((mod) => {
        const on = installed.has(mod.id)
        return (
          <div key={mod.id} className="engine-row">
            <div className="engine-main">
              <span className="engine-name">{mod.name}</span>
              <span className="engine-detail text-muted">
                {`${t(on ? "settings.plugins.modInstalled" : "settings.plugins.modAvailable")}, ${mod.description}`}
              </span>
            </div>
            <button type="button" onClick={() => flip(mod)}>
              {t(on ? "settings.plugins.uninstall" : "settings.plugins.install")}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function PluginsSection({ model }: { model: AppModel }) {
  const { client } = model
  const [plugins, setPlugins] = useState<readonly PluginRow[] | null>(
    () => lastReply<{ plugins: PluginRow[] }>(client, "plugins.list")?.plugins ?? null,
  )
  const load = useCallback(
    () =>
      requestRemembered<{ plugins: PluginRow[] }>(client, "plugins.list").then(
        (r) => setPlugins(r.plugins),
        (e) => toast(errorText(e), "error"),
      ),
    [client],
  )
  useEffect(() => {
    void load()
  }, [load])
  return (
    <>
      <BuiltinMods model={model} />
      {!plugins ? (
        <p className={PLACEHOLDER_LINE}>{t("preview.loading")}</p>
      ) : plugins.length === 0 ? (
        <p className={PLACEHOLDER_LINE}>{t("settings.plugins.empty")}</p>
      ) : (
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
                <span className="engine-name">{p.id}</span>
                <span className={`engine-detail ${MONO} text-muted`}>
                  {[p.version, p.linked ? "linked" : null, p.platformOk === false ? "unsupported platform" : null]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
            </label>
          ))}
        </div>
      )}
    </>
  )
}

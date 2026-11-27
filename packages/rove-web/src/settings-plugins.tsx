/**
 * Settings → Plugins: the first-party mods (Kanban, Issues) with an install switch each, then the
 * registry with an on/off switch each. Manifest settings and the marketplace stay Mac-side.
 */

import { useEffect } from "react"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { Group, Row, SectionPending, useSectionReply } from "./settings-rows.tsx"
import { useStore } from "./store.ts"
import { type PageId, page, toast } from "./ui.ts"
import { SETTINGS_STATUS } from "./ui/settings.ts"
import { Switch } from "./ui/switch.tsx"

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
  const { value, failed, reload } = useSectionReply<{ mods: ModRow[] }>(model.client, "builtinMods.list")
  const mods = value?.mods
  useEffect(() => {
    void model.refreshMods()
  }, [model])
  if (!mods)
    return failed === null ? null : (
      <Group title={t("settings.plugins.builtIn")}>
        <SectionPending failed={failed} onRetry={reload} />
      </Group>
    )
  if (mods.length === 0) return null
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
    <Group title={t("settings.plugins.builtIn")} hint={t("settings.plugins.builtInHint")}>
      {mods.map((mod) => (
        <Row key={mod.id} label={mod.name} hint={mod.description} inline>
          <Switch
            on={installed.has(mod.id)}
            aria-label={t("settings.plugins.turnOn", { name: mod.name })}
            onClick={() => flip(mod)}
          />
        </Row>
      ))}
    </Group>
  )
}

export function PluginsSection({ model }: { model: AppModel }) {
  const { client } = model
  const { value, failed, reload: load } = useSectionReply<{ plugins: PluginRow[] }>(client, "plugins.list")
  const plugins = value?.plugins
  return (
    <>
      <BuiltinMods model={model} />
      <Group title={t("settings.plugins.registered")}>
        {!plugins ? (
          <SectionPending failed={failed} onRetry={load} />
        ) : plugins.length === 0 ? (
          <p className={SETTINGS_STATUS}>{t("settings.plugins.empty")}</p>
        ) : (
          plugins.map((p) => (
            <Row
              key={p.id}
              label={p.id}
              hint={[
                p.version,
                p.linked ? t("settings.plugins.linked") : null,
                p.platformOk === false ? t("settings.plugins.unsupportedPlatform") : null,
              ]
                .filter(Boolean)
                .join(", ")}
              inline
            >
              <Switch
                on={p.enabled}
                aria-label={p.id}
                onClick={() =>
                  void client
                    .request("plugin.setEnabled", { id: p.id, enabled: !p.enabled })
                    .then(load)
                    .catch((e) => toast(errorText(e), "error"))
                }
              />
            </Row>
          ))
        )}
      </Group>
    </>
  )
}

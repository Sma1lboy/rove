/** Settings → Plugins: the registry with an on/off switch each. Manifest settings and the marketplace stay Mac-side. */

import { useCallback, useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { toast } from "./ui.ts"

interface PluginRow {
  readonly id: string
  readonly version?: string
  readonly enabled: boolean
  readonly linked?: boolean
  readonly platformOk?: boolean
}

export function PluginsSection({ client }: { client: BridgeClient }) {
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
            <span className="engine-name">{p.id}</span>
            <span className="muted engine-detail mono">
              {[p.version, p.linked ? "linked" : null, p.platformOk === false ? "unsupported platform" : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </label>
      ))}
    </div>
  )
}

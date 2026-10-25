/**
 * Settings, as the TUI's settings dialog: a section list on the left and the section on the
 * right. Every write is a bridge op on the same state.json keys the TUI writes, so both
 * surfaces read the same settings. The marketplace section is left out: installing a plugin
 * runs the repo's own build commands on the Mac. First-party mods install here: that runs nothing.
 */

import { useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { DialogShell } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { ts } from "./settings-copy.ts"
import { DevSection } from "./settings-dev.tsx"
import { EnginesSection } from "./settings-engines.tsx"
import { FeedbackSection } from "./settings-feedback.tsx"
import { GeneralSection } from "./settings-general.tsx"
import { KeysSection } from "./settings-keys.tsx"
import { PluginsSection } from "./settings-plugins.tsx"
import { RoutingSection } from "./settings-routing.tsx"

const SECTIONS = ["general", "engines", "autoRouting", "plugins", "keys", "feedback", "dev"] as const
type Section = (typeof SECTIONS)[number]

const BODY: Record<Section, (props: { client: BridgeClient; model: AppModel }) => React.ReactNode> = {
  general: (p) => <GeneralSection client={p.client} />,
  engines: (p) => <EnginesSection client={p.client} />,
  autoRouting: (p) => <RoutingSection client={p.client} />,
  plugins: (p) => <PluginsSection model={p.model} />,
  keys: (p) => <KeysSection client={p.client} />,
  feedback: (p) => <FeedbackSection client={p.client} />,
  dev: (p) => <DevSection client={p.client} />,
}

export function SettingsDialog({ model, section: opening = "general" }: { model: AppModel; section?: Section }) {
  const client = model.client
  useLocale()
  const [section, setSection] = useState<Section>(opening)
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
              {ts(`sections.${id}`)}
            </button>
          ))}
        </nav>
        <div className="settings-body">{BODY[section]({ client, model })}</div>
      </div>
    </DialogShell>
  )
}

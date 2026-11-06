/**
 * Settings as a dialog: a grouped section list on the left, one section on the right. Every write is a bridge
 * op on the same state.json keys the TUI writes, so both surfaces read the same settings. The marketplace section is left out: installing a plugin runs the repo's own build commands
 * on the Mac. First-party mods install here: that runs nothing. On a phone the list and the section take
 * turns: the list opens a section, and back returns to the list.
 */

import { type ReactNode, useEffect, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { useNarrow } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { AboutSection } from "./settings-about.tsx"
import { AppearanceSection } from "./settings-appearance.tsx"
import { ConnectorsSection } from "./settings-connectors.tsx"
import { ts } from "./settings-copy.ts"
import { DevSection } from "./settings-dev.tsx"
import { EnginesSection } from "./settings-engines.tsx"
import { FeedbackSection } from "./settings-feedback.tsx"
import { GeneralSection } from "./settings-general.tsx"
import { KeysSection } from "./settings-keys.tsx"
import { NotificationsSection } from "./settings-notifications.tsx"
import { PluginsSection } from "./settings-plugins.tsx"
import { RoutingSection } from "./settings-routing.tsx"
import { SECTION_GROUPS, type SettingsSection, backFrom, initialView } from "./settings-sections.ts"
import { SnippetsSection } from "./settings-snippets.tsx"
import { closeDialog } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { Chevron } from "./ui/chevron.tsx"
import {
  SETTINGS_BACK,
  SETTINGS_BODY,
  SETTINGS_CLOSE,
  SETTINGS_COLUMN,
  SETTINGS_DESC,
  SETTINGS_DIALOG,
  SETTINGS_HEAD,
  SETTINGS_NAV,
  SETTINGS_NAV_CHEVRON,
  SETTINGS_NAV_GROUP,
  SETTINGS_NAV_LABEL,
  SETTINGS_NAV_TITLE,
  SETTINGS_OVERLAY,
  SETTINGS_SCROLL,
  SETTINGS_TITLE,
  settingsNavItemClass,
} from "./ui/settings.ts"

const BODY: Record<SettingsSection, (model: AppModel) => ReactNode> = {
  general: (m) => <GeneralSection model={m} />,
  appearance: (m) => <AppearanceSection model={m} />,
  notifications: (m) => <NotificationsSection model={m} />,
  snippets: (m) => <SnippetsSection model={m} />,
  keys: (m) => <KeysSection model={m} />,
  engines: (m) => <EnginesSection client={m.client} />,
  autoRouting: (m) => <RoutingSection client={m.client} />,
  connectors: (m) => <ConnectorsSection model={m} />,
  plugins: (m) => <PluginsSection model={m} />,
  about: (m) => <AboutSection client={m.client} />,
  feedback: (m) => <FeedbackSection client={m.client} />,
  dev: (m) => <DevSection client={m.client} />,
}

/** Sections named by the TUI's catalog keep its words; the web's own are in `settings.sections`. */
const TUI_NAME: Partial<Record<SettingsSection, string>> = {
  general: "sections.general",
  engines: "sections.engines",
  autoRouting: "sections.autoRouting",
  plugins: "sections.plugins",
  keys: "sections.keys",
  feedback: "sections.feedback",
  dev: "sections.dev",
}

const sectionName = (id: SettingsSection): string => {
  const tui = TUI_NAME[id]
  return tui ? ts(tui) : t(`settings.sections.${id}`)
}

function SectionList(props: { current: SettingsSection; narrow: boolean; onPick: (id: SettingsSection) => void }) {
  return (
    <nav className={SETTINGS_NAV} aria-label={t("settings.title")}>
      <h1 className={SETTINGS_NAV_TITLE}>{t("settings.title")}</h1>
      {SECTION_GROUPS.map((group) => (
        <div key={group.id} className={SETTINGS_NAV_GROUP}>
          <p className={SETTINGS_NAV_LABEL}>{t(`settings.groups.${group.id}`)}</p>
          {group.sections.map((id) => (
            <Button
              key={id}
              variant="row"
              className={settingsNavItemClass(!props.narrow && props.current === id, group.id === "more")}
              aria-current={!props.narrow && props.current === id ? "page" : undefined}
              onClick={() => props.onPick(id)}
            >
              {sectionName(id)}
              <Chevron right className={SETTINGS_NAV_CHEVRON} />
            </Button>
          ))}
        </div>
      ))}
    </nav>
  )
}

/** `section` is a deep link (the engine notice opens on Engines). Esc closes; on a phone it first returns from a section to the list. */
export function SettingsDialog({ model, section: opening }: { model: AppModel; section?: SettingsSection }) {
  useLocale()
  const [view, setView] = useState(() => initialView(opening))
  const narrow = useNarrow()
  const back = () => (backFrom(view, narrow) === "list" ? setView({ ...view, drilled: false }) : closeDialog())
  useEffect(() => {
    // Opened from the terminal, focus would stay in xterm, which stops keys (Esc too) at itself.
    const dialog = document.querySelector<HTMLElement>(".dialog")
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      e.preventDefault()
      back()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  const showList = !narrow || !view.drilled
  const showSection = !narrow || view.drilled
  return (
    <div className={SETTINGS_OVERLAY} onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <dialog
        tabIndex={-1}
        open
        className={SETTINGS_DIALOG}
        aria-label={t("settings.title")}
        onKeyDown={(e) => {
          // Esc in a field leaves the field; the next Esc leaves the section or the dialog.
          const field = e.target
          if (e.key === "Escape" && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
            field.blur()
            e.stopPropagation()
            e.nativeEvent.stopImmediatePropagation()
          }
        }}
      >
        <Button
          variant="row"
          className={SETTINGS_CLOSE}
          aria-label={t("dialog.close")}
          title={t("dialog.close")}
          onClick={closeDialog}
        >
          ×
        </Button>
        {narrow && view.drilled && (
          <Button variant="row" className={SETTINGS_BACK} onClick={back}>
            {`‹ ${t("settings.title")}`}
          </Button>
        )}
        {showList && (
          <SectionList
            current={view.section}
            narrow={narrow}
            onPick={(id) => setView({ section: id, drilled: true })}
          />
        )}
        {showSection && (
          <div key={view.section} className={SETTINGS_SCROLL}>
            <div className={SETTINGS_COLUMN}>
              <header className={SETTINGS_HEAD}>
                <h1 className={SETTINGS_TITLE}>{sectionName(view.section)}</h1>
                <p className={SETTINGS_DESC}>{t(`settings.pages.${view.section}`)}</p>
              </header>
              <div className={SETTINGS_BODY}>{BODY[view.section](model)}</div>
            </div>
          </div>
        )}
      </dialog>
    </div>
  )
}

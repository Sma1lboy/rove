import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { ShortcutBadge } from "./prefix-guide.tsx"
import { ts } from "./settings-copy.ts"
import { skillMissing } from "./skill-status.ts"
import { useStore } from "./store.ts"
import { RAIL_FOOT, RAIL_FOOT_ROW, RAIL_NAV_CUE, RAIL_NAV_ICON, railNavRowClass } from "./ui/page.ts"
import { UsageChips } from "./usage-view.tsx"

/**
 * The rail's foot, ruled off from the task list: the usage readings, then Settings, one left edge and one
 * quiet voice, so the readings never read as a line of the last task. On a phone the readings sit at the
 * top of Settings instead, so only the entry is here. A missing Rove skill is named in words beside
 * Settings (the engines on hover); installing it is in Settings › Engines.
 */
export function RailFoot({ model, narrow, onSettings }: { model: AppModel; narrow: boolean; onSettings: () => void }) {
  useLocale()
  const gap = useStore(skillMissing)
  const hint = ts("engines.skill.bannerHintWeb", { engines: gap.join(", ") })
  return (
    <div className={RAIL_FOOT}>
      {!narrow && <UsageChips client={model.client} />}
      <div className={RAIL_FOOT_ROW}>
        <button type="button" className={`rail-nav-row ${railNavRowClass(false)}`} onClick={onSettings}>
          {/* Lucide `settings` (ISC). */}
          <svg className={RAIL_NAV_ICON} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>{t("rail.settings")}</span>
          {gap.length > 0 && (
            <span className={RAIL_NAV_CUE} title={hint}>
              {t("rail.skillCue")}
            </span>
          )}
        </button>
        <ShortcutBadge model={model} bindingId="settings.open" />
      </div>
    </div>
  )
}

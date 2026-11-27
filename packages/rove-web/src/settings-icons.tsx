/** A phone's Settings list: each section's glyph, muted, in one column. */

import type { SettingsSection } from "./settings-sections.ts"
import { SETTINGS_NAV_ICON } from "./ui/settings.ts"

const ICON: Readonly<Record<SettingsSection, string>> = {
  general: "M2 4.5h7m3 0h2M2 11.5h2m3 0h7M10.5 3v3M5.5 10v3",
  appearance: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 2v12M8 5h4.5M8 8h6M8 11h4.5",
  notifications: "M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3",
  snippets: "M3 4h10M3 8h6M3 12h8",
  keys: "M2 4.5h12v7H2zM4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.5h6",
  engines: "M2.5 3.5h11v9h-11zM5 6.5 7 8l-2 1.5M8.5 10H11",
  autoRouting: "M2 4h3l6 8h3M2 12h3l1.5-2M9.5 6 11 4h3",
  voice: "M8 1.5a2.5 2.5 0 0 1 2.5 2.5v4.5a2.5 2.5 0 0 1-5 0V4A2.5 2.5 0 0 1 8 1.5zM3 8a5 5 0 0 0 10 0M8 13v1.5",
  connectors: "M6.5 9.5l3-3M5 8 3.5 9.5a2.1 2.1 0 0 0 3 3L8 11M11 8l1.5-1.5a2.1 2.1 0 0 0-3-3L8 5",
  plugins: "M2.5 2.5H7V7H2.5zM9 2.5h4.5V7H9zM2.5 9H7v4.5H2.5zM11.25 9v4.5M9 11.25h4.5",
  about: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 7.5V11M8 5h.01",
  feedback: "M2.5 3.5h11v7h-6L4.5 13v-2.5h-2z",
  dev: "M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5",
}

export function SectionIcon({ id }: { id: SettingsSection }) {
  return (
    <svg viewBox="0 0 16 16" className={SETTINGS_NAV_ICON} aria-hidden="true">
      <path d={ICON[id]} />
    </svg>
  )
}

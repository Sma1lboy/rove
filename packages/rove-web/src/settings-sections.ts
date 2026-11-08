/** The Settings page's sections and the rules for moving between them; no DOM, so they can be tested. */

/** Section ids in nav order, grouped: everyday preferences, agents and what they use, then the quiet rest. */
export const SECTION_GROUPS = [
  { id: "preferences", sections: ["general", "appearance", "notifications", "snippets", "keys"] },
  { id: "agents", sections: ["engines", "autoRouting", "voice", "connectors", "plugins"] },
  { id: "more", sections: ["about", "feedback", "dev"] },
] as const

export type SettingsSection = (typeof SECTION_GROUPS)[number]["sections"][number]
export type SettingsGroup = (typeof SECTION_GROUPS)[number]["id"]

export interface SettingsView {
  readonly section: SettingsSection
  /** Narrow screens only: the section is open (true) or the section list is (false). */
  readonly drilled: boolean
}

export const FIRST_SECTION: SettingsSection = "general"

/** Opening with a section (a deep link) lands on it; opening bare starts at the first, with a phone showing the list. */
export const initialView = (section?: SettingsSection): SettingsView => ({
  section: section ?? FIRST_SECTION,
  drilled: section !== undefined,
})

/** What Esc and the back control do: a phone's open section goes back to the list, anything else closes Settings. */
export function backFrom(view: SettingsView, narrow: boolean): "list" | "close" {
  return narrow && view.drilled ? "list" : "close"
}

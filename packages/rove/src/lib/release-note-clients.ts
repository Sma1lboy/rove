/**
 * Which client a release-note entry is for. A changeset body opens with `[web][ios] …`;
 * `.changeset/changelog.mjs` writes that into the changelog line as `**web · ios**` after the
 * PR and commit links. An entry without a (valid) tag is untagged: every client shows it.
 */

export const NOTE_CLIENTS = ["web", "tui", "ios", "android", "cli", "daemon"] as const
export type NoteClient = (typeof NOTE_CLIENTS)[number]

/** What each client counts as its own. The iOS app shows the web, so the web counts ios. */
export const TUI_NOTE_CLIENTS: readonly NoteClient[] = ["tui", "cli", "daemon"]
export const WEB_NOTE_CLIENTS: readonly NoteClient[] = ["web", "ios", "daemon"]

/** A top-level bullet, past any leading `[label](url)` links (or their bare labels), to its `**a · b**`. */
const TAG = /^-\s+(?:(?:\[[^\]]*\]\([^)]*\)|#\d+|`[0-9a-f]{7,40}`)\s+)*\*\*([a-z]+(?: · [a-z]+)*)\*\*\s/

const isClient = (name: string): name is NoteClient => (NOTE_CLIENTS as readonly string[]).includes(name)

/** The clients an entry line is tagged for; null when untagged or the tag names an unknown client. */
export function entryClients(line: string): NoteClient[] | null {
  const names = TAG.exec(line)?.[1]?.split(" · ")
  return names?.every(isClient) ? names : null
}

export interface SplitNotes {
  /** Entries for this client plus untagged ones, under their headings. */
  readonly own: string
  /** Every other entry, under the same headings. */
  readonly other: string
  readonly otherCount: number
}

type Section = { head: string[]; entries: { lines: string[]; own: boolean }[] }

/** Split a release body (Changesets markdown) into this client's entries and the rest. */
export function splitReleaseNotes(body: string, shows: readonly NoteClient[]): SplitNotes {
  const sections: Section[] = [{ head: [], entries: [] }]
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    let section = sections[sections.length - 1] as Section
    if (/^#{1,6}\s/.test(line)) {
      section = { head: [], entries: [] }
      sections.push(section)
      section.head.push(line)
    } else if (/^[-*]\s/.test(line)) {
      const clients = entryClients(line)
      section.entries.push({ lines: [line], own: clients === null || clients.some((c) => shows.includes(c)) })
    } else {
      const entry = section.entries[section.entries.length - 1]
      ;(entry ? entry.lines : section.head).push(line)
    }
  }
  const render = (own: boolean) =>
    sections
      .map((s) => {
        const entries = s.entries.filter((e) => e.own === own)
        // A section with no entries (a preface) stays with this client's notes.
        if (entries.length === 0 && (s.entries.length > 0 || !own)) return ""
        return [...s.head, ...entries.flatMap((e) => e.lines)].join("\n").trim()
      })
      .filter(Boolean)
      .join("\n\n")
  const otherCount = sections.reduce((n, s) => n + s.entries.filter((e) => !e.own).length, 0)
  return { own: render(true), other: otherCount > 0 ? render(false) : "", otherCount }
}

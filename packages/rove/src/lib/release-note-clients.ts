/**
 * Release-note client classification and scope grouping.
 *
 * A changeset body opens with `[web][ios] …`; `.changeset/changelog.mjs` writes that into the
 * changelog line as `**web · ios**` after the PR and commit links. Older entries without bold
 * client tags fall back to conventional-commit scopes (`feat(web):`, `fix(ios):`, …). Entries
 * without either are untagged (`other`) and appear in every client's own view.
 */

export const NOTE_CLIENTS = ["web", "tui", "ios", "android", "cli", "daemon"] as const
export type NoteClient = (typeof NOTE_CLIENTS)[number]

/** Scope section IDs: each client plus `other` for untagged entries. */
export type NoteScope = NoteClient | "other"

/**
 * Own-client priority order. Specific scopes precede broader ones (`ios` before `web`), so
 * `[web][ios]` phone changes group under Phone & iPhone app while `[web]`-only changes group
 * under Web.
 */
export const TUI_NOTE_CLIENTS: readonly NoteClient[] = ["tui", "cli", "daemon"]
export const WEB_NOTE_CLIENTS: readonly NoteClient[] = ["ios", "web", "daemon"]

/** Canonical order for folded "other clients" sections. */
const ALL_SCOPES_ORDER: readonly NoteClient[] = ["ios", "web", "tui", "cli", "daemon", "android"]

/** Leading bullet plus any leading `[label](url)`, `#123` or `` `sha` `` references. */
const ENTRY_PREFIX = /^([-*]\s+(?:(?:\[[^\]]*\]\([^)]*\)|#\d+|`[0-9a-f]{7,40}`)\s+)*)/
const BOLD_CLIENT_TAG = /^\*\*([a-z]+(?: · [a-z]+)*)\*\*([ \t]+|$)/
const CONVENTIONAL_SCOPE =
  /^(?:feat|fix|refactor|perf|chore|docs|style|test|build|ci|revert)\(([a-z0-9_/-]+(?:\s*,\s*[a-z0-9_/-]+)*)\)!?:\s/

const CONVENTIONAL_SCOPE_MAP: Record<string, NoteClient> = {
  web: "web",
  "rove-web": "web",
  bridge: "web",
  "rove-bridge": "web",
  ios: "ios",
  "rove-ios": "ios",
  iphone: "ios",
  phone: "ios",
  mobile: "ios",
  android: "android",
  "rove-android": "android",
  tui: "tui",
  "tui-react": "tui",
  terminal: "tui",
  cli: "cli",
  api: "cli",
  daemon: "daemon",
  "rove-daemon": "daemon",
  pty: "daemon",
  "pty-host": "daemon",
  orchestrator: "daemon",
}

const isClient = (name: string): name is NoteClient => (NOTE_CLIENTS as readonly string[]).includes(name)

/**
 * The clients an entry line belongs to: explicit bold client tags (`**web · ios**`) first,
 * falling back to conventional commit scopes (`fix(web):`), or null when untagged.
 */
export function entryClients(line: string): NoteClient[] | null {
  const prefix = ENTRY_PREFIX.exec(line)
  if (!prefix) return null
  const rest = line.slice(prefix[0].length)

  const bold = BOLD_CLIENT_TAG.exec(rest)
  if (bold) {
    const names = bold[1]?.split(" · ") ?? []
    return names.length > 0 && names.every(isClient) ? names : null
  }

  const conv = CONVENTIONAL_SCOPE.exec(rest)
  if (!conv?.[1]) return null
  const matched: NoteClient[] = []
  for (const token of conv[1].split(/[,/]/)) {
    const mapped = CONVENTIONAL_SCOPE_MAP[token.trim().toLowerCase()]
    if (mapped && !matched.includes(mapped)) matched.push(mapped)
  }
  return matched.length > 0 ? matched : null
}

/** Remove a leading valid inline client tag (`**web · ios**`) while preserving the bullet and PR link. */
export function stripEntryClientTag(line: string): string {
  const prefix = ENTRY_PREFIX.exec(line)
  if (!prefix) return line
  const rest = line.slice(prefix[0].length)
  const bold = BOLD_CLIENT_TAG.exec(rest)
  if (!bold) return line
  const names = bold[1]?.split(" · ") ?? []
  if (names.length === 0 || !names.every(isClient)) return line
  return `${prefix[0]}${rest.slice(bold[0].length)}`
}

export interface ScopeSection {
  readonly scope: NoteScope
  /** Markdown bullet entries in this section (leading inline client tag stripped). */
  readonly entries: readonly string[]
  readonly count: number
}

export interface BumpGroup {
  /** Heading text (e.g. "Minor Changes", "Patch Changes"), or null when omitted for patch-only releases. */
  readonly heading: string | null
  readonly sections: readonly ScopeSection[]
}

export interface GroupedNotes {
  /** Leading text before any heading or bullet (e.g. a release preface). */
  readonly preface: string
  /** True when the release has a minor, major, or non-patch heading. */
  readonly hasSignificantBump: boolean
  /** Current client's sections (plus untagged `other`), ordered by `shows` then `other`. */
  readonly own: readonly BumpGroup[]
  /** Other clients' sections, folded under "Also in this release". */
  readonly other: readonly BumpGroup[]
  readonly ownCount: number
  readonly otherCount: number
  /** True when at least one entry matched a known scope (false for legacy untagged-only releases). */
  readonly hasScopedEntries: boolean
}

type BumpKind = "major" | "minor" | "patch" | "custom"

function classifyHeading(heading: string): BumpKind {
  const norm = heading.trim().toLowerCase()
  if (norm === "major changes" || norm === "重大更新") return "major"
  if (norm === "minor changes" || norm === "功能更新") return "minor"
  if (norm === "patch changes" || norm === "补丁更新") return "patch"
  return "custom"
}

interface ParsedEntry {
  readonly lines: string[]
  readonly own: boolean
  readonly scope: NoteScope
}

interface RawSection {
  readonly heading: string | null
  readonly kind: BumpKind | null
  readonly preface: string[]
  readonly entries: ParsedEntry[]
}

function buildScopeSections(entries: readonly ParsedEntry[], order: readonly NoteScope[]): ScopeSection[] {
  const buckets = new Map<NoteScope, string[]>()
  for (const entry of entries) {
    const list = buckets.get(entry.scope)
    const text = entry.lines.join("\n").trimEnd()
    if (list) list.push(text)
    else buckets.set(entry.scope, [text])
  }
  const out: ScopeSection[] = []
  for (const scope of order) {
    const list = buckets.get(scope)
    if (list && list.length > 0) out.push({ scope, entries: list, count: list.length })
  }
  return out
}

/**
 * Group a release body (Changesets markdown) into scope sections for this client (`own`)
 * and remaining clients (`other`). Patch-only bump headings are omitted unless the release
 * also includes a minor, major, or custom heading.
 */
export function groupReleaseNotes(body: string, shows: readonly NoteClient[]): GroupedNotes {
  const rawSections: RawSection[] = [{ heading: null, kind: null, preface: [], entries: [] }]
  const ownOrder: readonly NoteScope[] = [...shows, "other"]
  const otherOrder: readonly NoteClient[] = ALL_SCOPES_ORDER.filter((c) => !shows.includes(c))

  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    let section = rawSections[rawSections.length - 1] as RawSection
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line)
    if (headingMatch) {
      const heading = (headingMatch[1] ?? "").trim()
      section = { heading, kind: classifyHeading(heading), preface: [], entries: [] }
      rawSections.push(section)
    } else if (/^[-*]\s/.test(line)) {
      const clients = entryClients(line)
      let own: boolean
      let scope: NoteScope
      if (clients === null) {
        own = true
        scope = "other"
      } else {
        const ownMatch = shows.find((c) => clients.includes(c))
        if (ownMatch) {
          own = true
          scope = ownMatch
        } else {
          own = false
          scope = otherOrder.find((c) => clients.includes(c)) ?? clients[0]!
        }
      }
      section.entries.push({ lines: [stripEntryClientTag(line)], own, scope })
    } else {
      const entry = section.entries[section.entries.length - 1]
      ;(entry ? entry.lines : section.preface).push(line)
    }
  }

  const hasSignificantBump = rawSections.some(
    (s) => s.heading !== null && s.kind !== "patch" && (s.entries.length > 0 || s.preface.some((l) => l.trim() !== "")),
  )

  const prefaceParts = rawSections
    .filter((s) => s.heading === null || (!hasSignificantBump && s.kind === "patch"))
    .map((s) => s.preface.join("\n").trim())
    .filter(Boolean)
  const preface = prefaceParts.join("\n\n")

  const own: BumpGroup[] = []
  const other: BumpGroup[] = []

  if (hasSignificantBump) {
    for (const s of rawSections) {
      const ownSections = buildScopeSections(
        s.entries.filter((e) => e.own),
        ownOrder,
      )
      const otherSections = buildScopeSections(
        s.entries.filter((e) => !e.own),
        otherOrder,
      )
      if (ownSections.length > 0) own.push({ heading: s.heading, sections: ownSections })
      if (otherSections.length > 0) other.push({ heading: s.heading, sections: otherSections })
    }
  } else {
    const allEntries = rawSections.flatMap((s) => s.entries)
    const ownSections = buildScopeSections(
      allEntries.filter((e) => e.own),
      ownOrder,
    )
    const otherSections = buildScopeSections(
      allEntries.filter((e) => !e.own),
      otherOrder,
    )
    if (ownSections.length > 0) own.push({ heading: null, sections: ownSections })
    if (otherSections.length > 0) other.push({ heading: null, sections: otherSections })
  }

  const ownCount = own.reduce((n, g) => n + g.sections.reduce((m, s) => m + s.count, 0), 0)
  const otherCount = other.reduce((n, g) => n + g.sections.reduce((m, s) => m + s.count, 0), 0)
  const hasScopedEntries = [...own, ...other].some((g) => g.sections.some((s) => s.scope !== "other"))

  return { preface, hasSignificantBump, own, other, ownCount, otherCount, hasScopedEntries }
}

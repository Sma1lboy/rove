/**
 * Framework-free keymap DISPLAY: help-dialog grouping and the chord cap shared
 * by the help dialog and the Tasks-pane footer legend. The category mappers
 * live here, not in their components, because a CI guard must ask which
 * `keys.category` entries the catalog needs and can't import an opentui component.
 */

import type { KobeBinding, KobeBindingScope } from "../context/keybindings"
import { findBinding } from "../context/keybindings"
import type { BindingReachability } from "./keymap-reachability"

/** Group a flat keymap into categories in declaration order. */
export function groupBindings<T extends { readonly category: string }>(
  keymap: readonly T[],
): { category: string; rows: readonly T[] }[] {
  const grouped: { category: string; rows: T[] }[] = []
  const index = new Map<string, T[]>()
  for (const b of keymap) {
    let rows = index.get(b.category)
    if (!rows) {
      rows = []
      index.set(b.category, rows)
      grouped.push({ category: b.category, rows })
    }
    rows.push(b)
  }
  return grouped
}

/** `hint.keys` (refreshed in place by overrides), else the first chord. */
function capOf(row: Pick<KobeBinding, "keys" | "hint">): string | undefined {
  return row.hint?.keys ?? row.keys[0]
}

/** `null` for an unknown or unbound id: the row should drop, a dead chord is worse than none. */
export function legendCap(id: string): string | null {
  const row = findBinding(id)
  if (!row) return null
  const cap = capOf(row)
  return cap && cap.length > 0 ? cap : null
}

/** Composite row: survivors of {@link legendCap} joined with `/` (`r/b/v` → `r/v`); `null` if none survive. */
export function legendRowCap(ids: readonly string[]): string | null {
  const caps = ids.map(legendCap).filter((c): c is string => c !== null)
  return caps.length > 0 ? caps.join("/") : null
}

export type HelpSurface = Exclude<KobeBindingScope, "global" | "inbox">
type HelpGrammarKind = "here" | "direct" | "prefix" | "other"
type HelpGrammarRow = {
  binding: KobeBinding
  primary: string
  aliases: readonly string[]
}
export type HelpGrammarSection = {
  kind: HelpGrammarKind
  scope?: KobeBindingScope
  rows: readonly HelpGrammarRow[]
}

function directCap(row: KobeBinding): string | null {
  if (row.keys.length > 0) return row.hint?.keys ?? row.keys[0] ?? null
  // Doc-only rows (diff review, new-task tab cycler) advertise their hint: the
  // owning component registers the raw chord tagged with this row's id, which
  // puts them in the reachability scan. An unmounted owner makes them unreachable.
  return row.prefixKeys?.length ? null : (row.hint?.keys ?? null)
}

function availableOn(row: KobeBinding, surface: HelpSurface | null): boolean {
  if (row.scope === "global") return true
  if (surface === null) return false
  if (row.scope === surface) return true
  // Terminal is the workspace's embedded input surface: reserved workspace
  // chords and the prefix still apply there.
  return surface === "terminal" && row.scope === "workspace"
}

/**
 * Organize by input grammar: keys on the focused surface, one-press shortcuts,
 * prefix commands, then other panes' rows as reference.
 */
export function grammarHelpSections(
  keymap: readonly KobeBinding[],
  surface: HelpSurface | null,
  prefixKey: string | null,
  reachability?: BindingReachability,
): HelpGrammarSection[] {
  const here: HelpGrammarRow[] = []
  const direct: HelpGrammarRow[] = []
  const prefix: HelpGrammarRow[] = []
  const other = new Map<KobeBindingScope, HelpGrammarRow[]>()

  for (const binding of keymap) {
    const cap = directCap(binding)
    const staticallyAvailable = availableOn(binding, surface)
    const directAvailable = reachability ? reachability.direct.has(binding.id) : staticallyAvailable
    const prefixAvailable = reachability ? reachability.prefix.has(binding.id) : staticallyAvailable
    if (cap) {
      const row = { binding, primary: cap, aliases: binding.keys.filter((key) => key !== cap) }
      if (directAvailable && (staticallyAvailable || binding.presentation === "onePress")) {
        if (binding.presentation === "onePress") direct.push(row)
        else here.push(row)
      } else if (!staticallyAvailable && binding.scope !== "global") {
        const rows = other.get(binding.scope)
        if (rows) rows.push(row)
        else other.set(binding.scope, [row])
      }
    }
    if (prefixKey && prefixAvailable && binding.prefixKeys?.length) {
      prefix.push({
        binding,
        primary: `${prefixKey} + ${binding.prefixKeys[0]}`,
        aliases: binding.prefixKeys.slice(1).map((key) => `${prefixKey} + ${key}`),
      })
    }
  }

  const sections: HelpGrammarSection[] = []
  if (here.length) sections.push({ kind: "here", scope: surface ?? undefined, rows: here })
  if (direct.length) sections.push({ kind: "direct", rows: direct })
  if (prefix.length) sections.push({ kind: "prefix", rows: prefix })
  for (const [scope, rows] of other) sections.push({ kind: "other", scope, rows })
  return sections
}

/**
 * F1 section header; F1 groups by SCOPE, not the row's `category`. An
 * exhaustive Record so a new scope is a compile error, not a plausible wrong
 * header (an if-chain default once headed the Inbox rows "Dialog").
 */
const SCOPE_CATEGORY: Record<KobeBindingScope, string> = {
  global: "Global",
  sidebar: "Sidebar",
  workspace: "Workspace",
  files: "Files",
  inbox: "Inbox",
  terminal: "Terminal",
}

export function scopeCategory(scope: HelpGrammarSection["scope"]): string {
  return scope ? SCOPE_CATEGORY[scope] : "Global"
}

/**
 * Prefix-HUD guide header: mostly a synthetic set (`Views` / `Sessions` /
 * `Tasks` / …) with no `KobeKeymap.category` counterpart; unclaimed actions
 * fall back to their own category, then `Global`.
 */
export function guideCategory(action: string): string {
  if (["kanban.open", "automations.open", "workItems.open"].includes(action)) return "Views"
  if (action.startsWith("focus.")) return "Navigation"
  if (action.startsWith("inbox.") || action.startsWith("attention.")) return "Attention"
  if (action.startsWith("chat.tab.") || action.startsWith("chat.session.")) return "Sessions"
  if (action.startsWith("chat.fork.") || action.startsWith("task.")) return "Tasks"
  if (action.startsWith("settings.") || action === "workspace.zenToggle") return "Tools"
  return findBinding(action)?.category ?? "Global"
}

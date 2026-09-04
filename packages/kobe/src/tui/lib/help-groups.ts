/**
 * Framework-free keymap DISPLAY seam: grouping for the help
 * dialog plus the chord-cap resolution the Tasks-pane footer legend and the
 * help dialog share. `groupBindings` stays generic over the `category`
 * field; the cap helpers read the real keymap via `findBinding` (itself
 * framework-free and vitest-safe — tests import both directly).
 *
 * The two category mappers live here rather than in their rendering
 * components for the same reason: which header a binding prints under is the
 * only thing that says which `keys.category` entries the catalog must carry,
 * and a CI guard cannot import an opentui component to ask.
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

/**
 * The chord cap a keymap row advertises: the cosmetic `hint.keys` when
 * present (it's refreshed in place on an override — keymap-overrides.ts),
 * else the canonical first chord; `undefined` when the row has neither.
 */
function capOf(row: Pick<KobeBinding, "keys" | "hint">): string | undefined {
  return row.hint?.keys ?? row.keys[0]
}

/**
 * Resolve a single binding id to the chord cap a legend should advertise
 * ({@link capOf}). Returns `null` when the id is unknown or unbound (no
 * chords) — the row that owns it should then drop, since advertising a dead
 * chord is worse than none (mirrors the override path that nulls a hint on
 * unbind).
 */
export function legendCap(id: string): string | null {
  const row = findBinding(id)
  if (!row) return null
  const cap = capOf(row)
  return cap && cap.length > 0 ? cap : null
}

/**
 * Resolve a (possibly composite) legend row's keycap from the binding ids it
 * represents. Each id contributes its {@link legendCap}; unbound ids drop out
 * and the survivors join with `/` (so `r/b/v` becomes `r/v` if `b` is
 * unbound, or the whole row drops when nothing survives). Returns `null` when
 * every id resolved to no chord — the caller drops the row entirely.
 */
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
  // Documentation-only rows (the diff-review keys, the new-task tab cycler)
  // still describe a direct, surface-owned gesture through their friendly
  // hint. They carry no `keys`, so they are never dispatched from the table —
  // the owning component registers the raw chord and tags it with this row's
  // id, which is what puts them in the reachability scan alongside every
  // other row. A doc-only row whose owner is not mounted is unreachable and
  // must not be advertised.
  return row.prefixKeys?.length ? null : (row.hint?.keys ?? null)
}

function availableOn(row: KobeBinding, surface: HelpSurface | null): boolean {
  if (row.scope === "global") return true
  if (surface === null) return false
  if (row.scope === surface) return true
  // Terminal is the workspace's embedded input surface. Workspace-owned
  // reserved direct chords and the configured global prefix stay relevant
  // there; other unclaimed keys still pass through to the PTY.
  return surface === "terminal" && row.scope === "workspace"
}

/**
 * Reframe the catalogue around the user's input grammar: keys in the focused
 * surface, one-press Kobe shortcuts, then commands behind the configured
 * prefix. Remaining pane-local rows follow as reference instead of being
 * mixed into the primary list.
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
 * The category header the F1 help dialog prints a section under. The dialog
 * groups by SCOPE, not by the binding's own `category` field.
 *
 * A `Record` over the closed scope union rather than an if-chain with a
 * default: the chain ended in `return "Dialog"`, which no scope ever meant —
 * `inbox` fell through it and F1 headed the Inbox rows `OTHER PANE — Dialog`.
 * A default that is a valid catalogue string also satisfies the "every header
 * resolves" guard, so nothing caught it. Exhaustiveness makes the next scope
 * added to the union a compile error instead of a wrong-but-plausible header.
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
 * The category header the prefix HUD's guide groups an action under. Mostly
 * a synthetic set of its own (`Views` / `Sessions` / `Tasks` / …) that has no
 * counterpart in `KobeKeymap.category`, falling through to the binding's own
 * category — and then to `Global` — only for actions no rule claims.
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

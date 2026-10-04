/**
 * Split tree + naming for one terminal tab, over the content-agnostic
 * `split-core.ts`. Core owns WHICH tabs exist; this owns what's inside one and
 * what it's called. Never reads `TabsState` (the {@link TerminalTab} import is
 * type-only), so no naming/split rule can depend on the tab list.
 * {@link tabTitle} is framework-free so the strip and non-render callers share it.
 */

import type { VendorId } from "@/types/vendor"
import {
  engineEntry,
  engineStatusPrefixes,
  isEnginePlaceholderTitle,
  stripEngineStatusPrefix,
} from "../../engine/registry"
import { t } from "../i18n"
import { pathLeaf } from "../lib/path-helpers"
import { type SplitState, leaves } from "./split-core"
import type { TerminalTab } from "./terminal-tabs-core"

/**
 * Persisted split layout. Leaf payload `null` = the tab's own engine command
 * (only `leaf-1`), an argv = a split-created shell. JSON-safe for state.json.
 */
export type PersistedSplit = SplitState<readonly string[] | null>

/**
 * Whether the tab still runs its engine leaf (`leaf-1`); unsplit counts as yes.
 * Turn-activity callers (turn-poll loop, strip turn chip) must gate on this, or
 * a closed engine leaf leaves a stale poll against its released PTY.
 */
export function hasEngineLeaf(tree: PersistedSplit | null | undefined): boolean {
  return !tree || leaves(tree.root).some((l) => l.id === "leaf-1")
}

/**
 * >1 leaf. Gates ctrl+w / F2 fall-through between `TerminalTabs` and
 * `TerminalSplit`: while split, tab-level close/rename disable so chords reach
 * the leaf ones. A single surviving shell is NOT split.
 */
export function isTabSplit(tree: PersistedSplit | null | undefined): boolean {
  return tree ? leaves(tree.root).length > 1 : false
}

/**
 * A tree whose sole survivor is `leaf-1` folds to `null` (unsplit fast path). A
 * sole SHELL leaf keeps the tree — the fast path would respawn the engine over
 * it. Non-null also means "render via the tree".
 */
export function collapseSplit(next: PersistedSplit): PersistedSplit | null {
  const ls = leaves(next.root)
  return ls.length === 1 && ls[0]?.id === "leaf-1" ? null : next
}

/**
 * Registry key for a leaf's PTY. `leaf-1` IS the tab key, so the pre-split PTY
 * is reused, not respawned; later leaves namespace under it.
 */
export function splitLeafPtyKey(tabKey: string, leafId: string): string {
  return leafId === "leaf-1" ? tabKey : `${tabKey}::${leafId}`
}

/** Default name for a split-created shell leaf; shared so the corner tag and a collapsed tab's label agree. */
const SHELL_LEAF_NAME = "shell"

/**
 * Leaf id → display name. Manual `leaf.title` wins and is never suffixed.
 * Engine leaf (`null` content): `engineTitle` (the tab's title/autoTitle), else
 * its live title, else the command basename. Shell leaf: its live OSC 0/2 title
 * ("zsh", "vim"), else "shell". Duplicate defaults get a reading-order suffix
 * ("shell", "shell 2").
 */
export function splitLeafNames(
  leafList: readonly { id: string; title?: string | null; content: readonly string[] | null }[],
  tabCommand: readonly string[],
  engineTitle?: string | null,
  liveTitles?: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const basename = (argv: readonly string[] | null): string => {
    const head = (argv ?? tabCommand)[0] ?? ""
    const name = pathLeaf(head)
    return name.length > 0 ? name : "?"
  }
  const seen = new Map<string, number>()
  const out = new Map<string, string>()
  for (const leaf of leafList) {
    if (leaf.title) {
      out.set(leaf.id, leaf.title)
      continue
    }
    // Live title before basename: a shell tab's leaf-1 runs zsh and can enter
    // claude/vim, so the static basename would freeze on "zsh".
    const name =
      leaf.content === null
        ? engineTitle || liveTitles?.get(leaf.id) || basename(leaf.content)
        : liveTitles?.get(leaf.id) || SHELL_LEAF_NAME
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    out.set(leaf.id, n === 1 ? name : `${name} ${n}`)
  }
  return out
}

/**
 * A first prompt that was a menu answer ("1", "y", "ok") or bare punctuation
 * doesn't name the tab. Display-side so persisted junk heals without migration.
 */
export function meaningfulAutoTitle(autoTitle: string | null | undefined): string | null {
  const trimmed = (autoTitle ?? "").trim()
  if (trimmed.length < 3) return null
  if (/^[\d\s\p{P}\p{S}]+$/u.test(trimmed)) return null
  return trimmed
}

/**
 * The recorded title as a stable name, or null. Strips status decoration
 * (idempotent; old snapshots heal on display), then rejects decoration-only
 * titles: `stripEngineStatusPrefix` keeps a lone "✳" as a real session name,
 * but in the tree a lone glyph isn't a label.
 */
function stableRecordedTitle(raw: string | null | undefined, vendor: VendorId): string | null {
  const recorded = raw?.trim()
  if (!recorded) return null
  const cleaned = stripEngineStatusPrefix(recorded, vendor)
  // Unchanged AND made only of this engine's glyphs = decoration, not a name.
  if (cleaned === recorded && isEngineDecoration(recorded, vendor)) return null
  // A placeholder (codex's thread UUID until named) isn't a name either; the
  // real title wins once codex names the thread.
  if (isEnginePlaceholderTitle(cleaned, vendor)) return null
  return cleaned || null
}

/** True when every character of `text` is one of the engine's status glyphs. */
function isEngineDecoration(text: string, vendor: VendorId): boolean {
  const glyphs = new Set(engineStatusPrefixes(vendor))
  return [...text].every((ch) => ch.trim().length === 0 || glyphs.has(ch))
}

/**
 * Tab name for the sidebar tree, which draws kobe's own state glyph beside it:
 * strip the decoration, keep the name. Old snapshots still carry the prefix,
 * so it's stripped again here (display-side). A manual rename still wins.
 *
 * `liveTitle` is the pty host's current OSC title. `lastTitle` is only written
 * by the mounted `TerminalTabs` (selected task), so other rows would freeze.
 * Passing it in here keeps it under the same strip/reject/rename rules; absent
 * → the recorded title, which also covers the live probe's ~2s gap.
 */
export function tabTitleStable(
  tab: TerminalTab,
  taskVendor: VendorId,
  liveVendor?: VendorId | null,
  liveTitle?: string | null,
): string {
  // `liveVendor` is tri-state: vendor = runs NOW; null = probe CONFIRMED no
  // engine (ctrl+C'd to the prompt); undefined = probe can't answer. A
  // confirmed-dead engine tab is a shell: neither its frozen status line nor
  // its creation pin may name it.
  if (liveVendor === null && tab.kind === "engine") {
    return tabTitle({ ...tab, kind: "command", lastTitle: null } as TerminalTab, taskVendor)
  }
  // Live probe, then recorded identity, then the creation pin. The recorded
  // step prevents a flash: clicking writes `lastTitle` at once but the probe is
  // a ~2s ps walk, and without it the raw engine status line ("⠐ Refactoring…")
  // shows for one render.
  const vendor =
    liveVendor ?? tab.liveVendor ?? (tab.kind === "engine" ? (tab.vendor ?? taskVendor) : undefined) ?? undefined
  // Cleaning is NOT gated on `ownsStatus`: the resolved vendor is often a user
  // wrapper (`claudecpa`, a zsh function running real claude) that declares
  // nothing, and gating left those tabs wearing `⠂ …`. `ownsStatus` only picks
  // the fallback below. Live beats recorded; falling back keeps the flash guard.
  const source = liveTitle?.trim() || tab.lastTitle
  const named = vendor ? stableRecordedTitle(source, vendor) : (source ?? null)
  if (!vendor || engineEntry(vendor).terminalTitle?.ownsStatus !== true) {
    // The resolved vendor still names the tab: an engine writing no title (a
    // custom preset, contrib CLI) falls back to its name, not `shell N`. Hit by
    // command tabs — a shell the user typed the engine into, or an engine tab a
    // past probe demoted (`foreground.ts#customEngineBinaries`). Naming only;
    // no session/resume implied.
    return tabTitle(
      { ...tab, ...(vendor ? { kind: "engine", vendor } : {}), lastTitle: named } as TerminalTab,
      taskVendor,
    )
  }
  // Normal precedence with the recorded title cleaned (empty → next rung:
  // first-prompt summary, then vendor default). The resolved vendor replaces
  // the creation pin — a codex-spawned tab now running claude isn't "codex N" —
  // and rides along for command tabs too. `kind` only steers `tabTitle`'s
  // vendor-default branch, so this is naming-only (see terminal-tab-identity.ts).
  return tabTitle({ ...tab, kind: "engine", vendor, lastTitle: named } as TerminalTab, taskVendor)
}

/**
 * Whose title rules judge this tab's name: running now, else launched as, else
 * the task's engine. A confirmed-dead engine still falls back to the pin —
 * "is this a name" is about the SHAPE the engine writes.
 */
function titleVendor(tab: TerminalTab, taskVendor: VendorId): VendorId {
  return tab.liveVendor ?? (tab.kind === "engine" ? tab.vendor : undefined) ?? taskVendor
}

/**
 * "$process $ordinal" ("claude 3", "vim 2"), never "tab N". `liveName` comes
 * from `useTurnPolls().liveTitles`; callers without it (notifications) fall
 * back. Also used outside render (rename prefill, notifications), so it uses
 * module-level `t()`, not `useT()`.
 */
export function tabTitle(tab: TerminalTab, taskVendor: VendorId, liveName?: string | null): string {
  // Order: rename > split group > live process > last recorded > first-prompt
  // > vendor default. A multi-leaf split is "group N" (leaves carry names).
  if (tab.title) return tab.title
  const ls = tab.splitTree ? leaves(tab.splitTree.root) : []
  if (ls.length > 1) return t("terminal.tab.groupTitle", { n: tab.ordinal })
  // Collapsed to a single shell leaf → its rename, else its live process name.
  const sole = ls.length === 1 ? ls[0] : undefined
  if (sole && sole.id !== "leaf-1") return sole.title ?? `${liveName ?? SHELL_LEAF_NAME} ${tab.ordinal}`
  // Vendor comes from the tab, not the task's CURRENT engine: that would
  // relabel every inherit-mode tab when a new tab switches the task engine. A
  // placeholder live title (codex's thread id) falls through.
  const vendor = titleVendor(tab, taskVendor)
  if (liveName && !isEnginePlaceholderTitle(liveName, vendor)) return `${liveName} ${tab.ordinal}`
  // No live title (a surface not hosting the tab, e.g. the Inbox): use the last
  // recorded one, else a long-moved-on tab reads as its opening question.
  if (tab.lastTitle && !isEnginePlaceholderTitle(tab.lastTitle, vendor)) return `${tab.lastTitle} ${tab.ordinal}`
  const auto = meaningfulAutoTitle(tab.autoTitle)
  if (auto) return auto
  const name =
    tab.kind === "engine"
      ? (engineEntry(tab.vendor ?? taskVendor).defaultCommand[0] ?? SHELL_LEAF_NAME)
      : SHELL_LEAF_NAME
  return `${name} ${tab.ordinal}`
}

/**
 * True only when `tabTitle` renders an engine-owned live title. `vendor` is the
 * resolved live identity (`useTurnPolls().turnVendors`, same `turn-target.ts`
 * rule as detectors), so a typed `claude` and a kobe-launched tab behave the
 * same. Native status is visible iff the label IS the live title.
 */
export function visibleNativeStatus(
  tab: TerminalTab,
  taskVendor: VendorId,
  vendor: VendorId | undefined,
  liveName?: string | null,
): boolean {
  if (!vendor || !liveName) return false
  if (engineEntry(vendor).terminalTitle?.ownsStatus !== true) return false
  return tabTitle(tab, taskVendor, liveName) === `${liveName} ${tab.ordinal}`
}

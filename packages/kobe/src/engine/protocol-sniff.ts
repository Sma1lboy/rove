/**
 * Tier (b) of protocol resolution (tiers: `engine-presets.ts`): name the
 * engine behind a session whose launch command could not be named (a wrapper,
 * alias, or script). Two fingerprints, neither hard-coded here:
 *
 *   - the OSC title's status glyph: the `terminalTitle.statusPrefixes` table
 *     that `engineTitleTurnHint` reads forward, read backward ("which vendor
 *     writes this glyph?").
 *   - a session file under the task's worktree
 *     (`EngineHistoryReader.listSessionIdsForWorktree`): every built-in keys
 *     its store by cwd or records it.
 *
 * Evidence, never a default: nothing recognisable answers null and the caller
 * stays generic. A glyph shared by several vendors identifies none, because a
 * wrong protocol points the history reader and trust store at another
 * vendor's files.
 *
 * Consumer: {@link protocolUpgradeFromLiveSession}, fed by the daemon's
 * activity observer, upgrades a generic record's `vendor` via `setCommand`
 * (metadata only; what launches never changes). The session-store read is
 * deliberately unused there: a transcript can outlive the engine that wrote
 * it (a worktree re-pinned to another CLI would mis-identify), so the upgrade
 * trusts only evidence about the session running now.
 */

import { BUILTIN_VENDORS, type VendorId, isBuiltinVendor } from "@/types/vendor"
import { GENERIC_PROTOCOL, getEngineProtocol, resolveCommandProtocol } from "./engine-presets.ts"
import { engineEntry } from "./registry.ts"

/**
 * Vendor whose status vocabulary this title starts with, or null. Only glyphs
 * unique to one vendor identify: codex and claude share braille frames, so
 * `⠹` means "some engine", not codex.
 */
export function sniffProtocolFromTitle(title: string | null | undefined): VendorId | null {
  const trimmed = title?.trim()
  if (!trimmed) return null
  const owners = new Map<string, VendorId[]>()
  for (const vendor of BUILTIN_VENDORS) {
    for (const glyph of engineEntry(vendor).terminalTitle?.statusPrefixes ?? []) {
      owners.set(glyph, [...(owners.get(glyph) ?? []), vendor])
    }
  }
  // Longest first, as `stripEngineStatusPrefix` does.
  for (const glyph of [...owners.keys()].sort((a, b) => b.length - a.length)) {
    if (!trimmed.startsWith(glyph)) continue
    // A title that is only the glyph is a name, not a status.
    if (trimmed.slice(glyph.length).trim().length === 0) continue
    const vendors = owners.get(glyph) ?? []
    if (vendors.length === 1) return vendors[0]
    return null // ambiguous vocabulary — no verdict
  }
  return null
}

/** Vendor whose store has sessions for `worktree`, or null; several vendors → null, not a pick. */
export async function sniffProtocolFromSessions(worktree: string | undefined): Promise<VendorId | null> {
  if (!worktree) return null
  const found: VendorId[] = []
  for (const vendor of BUILTIN_VENDORS) {
    try {
      const ids = await engineEntry(vendor).history.listSessionIdsForWorktree(worktree)
      if (ids.length > 0) found.push(vendor)
    } catch {
      /* a store that cannot be read is not evidence */
    }
  }
  return found.length === 1 ? found[0] : null
}

/** What the observer knows about one LIVE, walked engine-tab session. */
export interface LiveSessionEvidence {
  /** Built-in vendor whose process the foreground walk found under the pid, or
   *  null (a renamed binary reads null; the title covers that). */
  readonly walkVendor: string | null
  /** The session's current OSC title. */
  readonly title: string
}

/**
 * `setCommand` payload naming a generic task's protocol from its live tab, or
 * null. Every refusal is deliberate:
 *
 *   - no pinned `command`: such records launch from `vendor`
 *     (`types/task.ts`), so writing it would change what spawns.
 *   - `vendor` already a built-in: never flip one engine to another.
 *   - tier (a) resolves the command: a declared protocol (even one declared
 *     after task creation) beats runtime evidence.
 *   - evidence names nothing: staying generic is always safe.
 *
 * Walk outranks title: a process is the engine; a title is what it last wrote.
 */
export function protocolUpgradeFromLiveSession(
  task: { readonly vendor?: string; readonly command?: string },
  evidence: LiveSessionEvidence,
): { command: string; vendor: VendorId } | null {
  const command = task.command?.trim()
  if (!command) return null
  if (task.vendor && isBuiltinVendor(task.vendor)) return null
  if (resolveCommandProtocol(command) !== GENERIC_PROTOCOL) return null
  const walk = evidence.walkVendor
  const vendor = walk !== null && isBuiltinVendor(walk) ? walk : sniffProtocolFromTitle(evidence.title)
  return vendor ? { command, vendor } : null
}

/**
 * Protocol to persist as `engineProtocol.<id>` for the custom preset the
 * session launched under, or null. Without it every task on a wrapper preset
 * (`claudecpa`, a zsh function passing `"$@"` to claude) gets "no transcript"
 * from the history reader, trust store, and fork verb until declared in Settings.
 *
 * Refusals differ from the record upgrade on purpose:
 *
 *   - a declared protocol always wins (`getEngineProtocol` also answers for
 *     built-in and contrib ids).
 *   - the id must be a registered custom engine; a raw `--command` would grow
 *     state.json a row per ad-hoc command line.
 *   - only the walk counts: this key outlives every session on the preset,
 *     unlike a record a later `setCommand` can correct.
 *
 * Not gated on a pinned `command`: this key says how to talk, not what spawns.
 * Idempotent: after the write, `getEngineProtocol(id)` answers and the next
 * tick returns null.
 */
export function protocolWriteBackFromLiveSession(
  task: { readonly vendor?: string },
  evidence: LiveSessionEvidence,
  customEngineIds: readonly string[],
): { id: string; protocol: VendorId } | null {
  const id = task.vendor?.trim()
  if (!id) return null
  if (getEngineProtocol(id) !== undefined) return null
  if (!customEngineIds.includes(id)) return null
  const walk = evidence.walkVendor
  return walk !== null && isBuiltinVendor(walk) ? { id, protocol: walk } : null
}

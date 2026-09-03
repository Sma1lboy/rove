/**
 * Tier (b) of protocol resolution: name the engine behind a session whose
 * LAUNCH COMMAND could not be named (see `engine-presets.ts` for the tiers).
 *
 * A raw `--command` may be a wrapper, an alias, or a script — argv[0] says
 * nothing. But a running engine leaves two fingerprints that no neutral
 * layer has to hard-code:
 *
 *   - its OSC title's STATUS GLYPH. Engines that own their title write a
 *     declared vocabulary into it (`terminalTitle.statusPrefixes`, claude's
 *     ✳/⠂, codex's braille frames). The daemon's title pipeline already
 *     reads that vocabulary FORWARD (`engineTitleTurnHint(vendor, title)`
 *     asks "is this vendor working?"); this is the same table read
 *     BACKWARD — "which vendor writes a glyph like this?".
 *   - a SESSION FILE appearing under the task's worktree. Every built-in
 *     keys its transcript store by cwd or records the cwd in the rollout,
 *     which is exactly what `EngineHistoryReader.listSessionIdsForWorktree`
 *     resolves. A store that answers for this worktree is the engine that
 *     wrote it.
 *
 * Both are evidence, never a default: nothing recognisable answers `null`
 * and the caller stays on the generic protocol. The glyph read is
 * deliberately conservative — a glyph shared by several vendors identifies
 * none of them, because a wrong protocol is worse than no protocol (it
 * points the history reader and the trust store at another vendor's files).
 * Today's built-in vocabularies are disjoint (claude's ✳/⠂/⠐/◐/◑ vs codex's
 * ten braille frames), so that rule costs nothing now and is what keeps a
 * future engine borrowing a glyph from silently stealing its identity.
 *
 * The consumer is {@link protocolUpgradeFromLiveSession}: the
 * daemon's activity observer relays each walked live session's evidence
 * (foreground-walk vendor + OSC title) and, when a task that recorded the
 * generic protocol is identified, upgrades the record's `vendor` via
 * `setCommand` — metadata only, so the history reader / trust store /
 * delivery mode start applying while WHAT LAUNCHES never changes. The
 * session-store read stays unconsumed there on purpose: a transcript can
 * outlive the engine that wrote it (a worktree whose transcripts came from
 * claude and was later re-pinned to a different CLI would mis-identify), so the
 * record upgrade only trusts evidence that describes the session running
 * right now. Both sniff reads stay pure.
 */

import { BUILTIN_VENDORS, type VendorId, isBuiltinVendor } from "@/types/vendor"
import { GENERIC_PROTOCOL, getEngineProtocol, resolveCommandProtocol } from "./engine-presets.ts"
import { engineEntry } from "./registry.ts"

/**
 * The vendor whose status vocabulary this live title starts with, or null.
 * Only glyphs UNIQUE to one vendor identify: codex and claude share braille
 * frames, so a `⠹` prefix is evidence of "some engine", not of codex.
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
  // Longest glyph first, mirroring `stripEngineStatusPrefix`'s rule so a
  // multi-char prefix is never shadowed by a shorter one.
  for (const glyph of [...owners.keys()].sort((a, b) => b.length - a.length)) {
    if (!trimmed.startsWith(glyph)) continue
    // A title that is ONLY the glyph is a name, not a status (same
    // conservatism as the strip path).
    if (trimmed.slice(glyph.length).trim().length === 0) continue
    const vendors = owners.get(glyph) ?? []
    if (vendors.length === 1) return vendors[0]
    return null // ambiguous vocabulary — no verdict
  }
  return null
}

/**
 * The vendor whose transcript store has sessions for `worktree`, or null.
 * Best-effort by contract (readers never throw); a worktree several engines
 * have touched answers null rather than picking one.
 */
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
  /** Foreground-walk verdict for the session's pid: a built-in vendor whose
   *  process is running in the tree, or null for "no recognisable engine"
   *  (a renamed binary reads as null — that's what the title covers). */
  readonly walkVendor: string | null
  /** The session's current OSC title. */
  readonly title: string
}

/**
 * The record upgrade, tier (b)'s consumer: the `setCommand` payload that
 * names a generic task's protocol from its live engine tab, or null to
 * leave the record alone. Every refusal is deliberate:
 *
 *   - no pinned `command` → null. Pre-`command` records LAUNCH from
 *     `vendor` (see `types/task.ts`), so writing a sniffed protocol there
 *     would change what spawns, not just how kobe talks to it.
 *   - `vendor` already names a built-in → null. A named protocol is
 *     authoritative; sniffing must never flip one engine to another.
 *   - tier (a) can resolve the command → null. A declared or derivable
 *     protocol (including one declared AFTER the task was created) wins
 *     over runtime evidence.
 *   - evidence names nothing (walk found no engine, title glyph absent or
 *     ambiguous) → null. Staying generic is always safe; a wrong upgrade
 *     points the history reader and trust store at another vendor's files.
 *
 * Walk evidence outranks the title: a process in the tree is the engine
 * itself, while a title is what the engine last wrote.
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
 * Tier (b)'s SECOND product: the protocol to persist for the custom PRESET
 * the session was launched under, or null.
 *
 * The record upgrade above names ONE task. A wrapper preset (`claudecpa`, a
 * zsh function that passes `"$@"` to claude) is launched by every future task
 * that picks it, and each one re-learns nothing: the preset itself has no
 * `engineProtocol.<id>`, so the history reader, the trust store and the fork
 * verb all keep answering "no transcript" until someone opens Settings and
 * declares it. Writing the key once, from the process the walk actually
 * found, is what makes the next task start named.
 *
 * The refusals differ from the record upgrade's on purpose:
 *
 *   - a declared protocol wins, always. `getEngineProtocol` already answers
 *     the id itself for a built-in or contrib engine, so those are covered by
 *     the same check.
 *   - the id must be a REGISTERED custom engine. That is the durability bar:
 *     a raw `--command` string is a one-off, and minting a persistent
 *     `engineProtocol.<one-off>` key from one would leave state.json growing
 *     a row per ad-hoc command line.
 *   - only the WALK names it. A title glyph is what the engine last wrote and
 *     is good enough for a record that a later `setCommand` can correct; this
 *     key outlives every session on the preset, so it takes the running
 *     process as its only evidence.
 *
 * Deliberately NOT gated on a pinned `command`: a preset id IS the launch
 * instruction (`engineCommand.<id>` holds the command line), so the reason
 * the record upgrade refuses a command-less task — that writing there would
 * change what spawns — does not apply to a key that only says how to TALK.
 *
 * Idempotent: the write makes `getEngineProtocol(id)` answer, so the next
 * tick resolves null.
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

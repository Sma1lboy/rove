/**
 * One-shot renames of SHIPPED `state.json` keys.
 *
 * Renaming a settings key that has never been released is free. Renaming one
 * people already have is not: `state.json` is theirs to hand-edit, the
 * CHANGELOG has told them which keys to edit, and a reader that simply stops
 * looking at the old name turns their configuration into a silent no-op.
 * `autoEffort.<tier>.engine` is exactly that shape — `readAutoRoutingTable`
 * treats a tier with no engine as "the feature is off", so a bare rename
 * would have switched auto routing off for everyone who had ever retargeted
 * a tier, with nothing printed anywhere.
 *
 * So the old keys are MOVED, once, before anything reads them: the value
 * lands under the new name and the old key is deleted in the same locked
 * read-modify-write. Deliberately not a dual read — two names for one setting
 * is a permanent branch in every reader and a permanent question about which
 * one wins when both exist. One move, and afterwards there is one name.
 *
 * Runs from `cli/rename-compat.ts` at process start, after the `.kobe` → `.rove`
 * layout copy has put the file where this can find it, and before any verb,
 * the TUI, or the daemon has read a key. Cheap when there is nothing to do:
 * the prefix scan is one read of an already-small file, and the lock is taken
 * only when a legacy key is actually present.
 */

import { loadStateFile, updateStateFile } from "./store.ts"

/**
 * Key prefixes that changed name after shipping, oldest first.
 *
 * An entry earns its place here by having been in a published version; a key
 * renamed before release is just renamed. Entries are removed once the
 * versions that wrote them are far enough back that nobody upgrades across
 * them — a migration is a bridge, not a permanent part of the format.
 *
 * `autoEffort.` shipped in v0.9.207 (#1027) and was documented in the
 * CHANGELOG as a thing to hand-edit, so it is carried rather than dropped.
 */
export const RENAMED_KEY_PREFIXES: readonly { readonly from: string; readonly to: string }[] = [
  { from: "autoEffort.", to: "autoRouting." },
]

export interface StateKeyMigrationResult {
  /** Keys whose value was carried over to the new name. */
  readonly moved: number
  /**
   * Legacy keys deleted WITHOUT carrying their value, because the new name
   * was already set. The newer name is the one the user (or this version's
   * Settings) wrote last, so it wins; keeping the stale twin would leave a
   * value that no reader consults and every bug report shows.
   */
  readonly superseded: number
}

const NOTHING: StateKeyMigrationResult = { moved: 0, superseded: 0 }

function legacyRename(key: string): string | undefined {
  for (const { from, to } of RENAMED_KEY_PREFIXES) {
    if (key.startsWith(from)) return `${to}${key.slice(from.length)}`
  }
  return undefined
}

/**
 * Move every renamed key to its new name, once. Idempotent: a second call
 * finds no legacy key and writes nothing.
 *
 * Never throws — a settings rename is not allowed to stop the CLI from
 * starting. An I/O failure leaves the legacy keys in place, which is exactly
 * the state the next launch retries from.
 */
export function migrateRenamedStateKeys(): StateKeyMigrationResult {
  let hasLegacy: boolean
  try {
    hasLegacy = Object.keys(loadStateFile()).some((key) => legacyRename(key) !== undefined)
  } catch {
    return NOTHING
  }
  if (!hasLegacy) return NOTHING

  let moved = 0
  let superseded = 0
  try {
    updateStateFile((state) => {
      // Re-read under the lock: the peek above is unsynchronized, so the
      // keys that actually get moved are the ones on disk right now.
      for (const [key, value] of Object.entries(state)) {
        const renamed = legacyRename(key)
        if (renamed === undefined) continue
        if (renamed in state) superseded += 1
        else {
          state[renamed] = value
          moved += 1
        }
        delete state[key]
      }
      return moved + superseded > 0
    })
  } catch {
    return NOTHING
  }
  return { moved, superseded }
}

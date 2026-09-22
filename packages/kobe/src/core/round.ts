/**
 * Attempt COUNT → the `createTask` inputs of a round. Invariants: every sibling
 * shares ONE `groupId` (else `collect --group` finds nothing) and `#i/N`
 * follows creation order. Matches `cli/api/handlers-add.ts`'s fan-out, so TUI
 * and `rove api add --count` rounds are indistinguishable.
 */

import { ulid } from "../orchestrator/index/ulid.ts"

/** One sibling's create input: what the round adds on top of the caller's own. */
export interface RoundSibling {
  /** Shared by every sibling of one round; absent for a single attempt. */
  readonly groupId?: string
  /** `<title> #i/N`, or the bare title for a single attempt; absent with no title. */
  readonly title?: string
}

/** `attempts <= 1` → one sibling, no `groupId`, unsuffixed title: a lone fork is not a round. */
export function planRound(attempts: number, title?: string): readonly RoundSibling[] {
  const n = Math.max(1, Math.trunc(attempts))
  if (n === 1) return [title ? { title } : {}]
  const groupId = ulid()
  return Array.from({ length: n }, (_, i) => ({
    groupId,
    ...(title ? { title: `${title} #${i + 1}/${n}` } : {}),
  }))
}

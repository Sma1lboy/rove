/**
 * The pure half of "fan out N attempts at one prompt" — turning an attempt
 * COUNT into the list of `createTask` inputs a round is made of.
 *
 * Its own module, and pure, because the round's two invariants are the ones a
 * live run cannot show you: every sibling carries the SAME `groupId` (or
 * `collect --group` finds nothing and the round is three loose tasks), and the
 * `#i/N` ordinals line up with creation order. Both are asserted here rather
 * than inferred from a screenshot.
 *
 * The shape deliberately matches `cli/api/handlers-add.ts`'s fan-out, so a
 * round started from the TUI and one started by `rove api add --count` are
 * indistinguishable on the row and to `collect`.
 */

import { ulid } from "../orchestrator/index/ulid.ts"

/** One sibling's create input: what the round adds on top of the caller's own. */
export interface RoundSibling {
  /** Shared by every sibling of one round; absent for a single attempt. */
  readonly groupId?: string
  /** `<title> #i/N`, or the bare title for a single attempt; absent with no title. */
  readonly title?: string
}

/**
 * Plan `attempts` siblings.
 *
 * `attempts <= 1` returns ONE sibling with no `groupId` and an unsuffixed
 * title: a lone fork is not a round, and marking it as one would make
 * `collect --group` report a "round" of a single task.
 */
export function planRound(attempts: number, title?: string): readonly RoundSibling[] {
  const n = Math.max(1, Math.trunc(attempts))
  if (n === 1) return [title ? { title } : {}]
  const groupId = ulid()
  return Array.from({ length: n }, (_, i) => ({
    groupId,
    ...(title ? { title: `${title} #${i + 1}/${n}` } : {}),
  }))
}

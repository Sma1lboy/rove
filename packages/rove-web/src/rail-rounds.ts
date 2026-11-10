/** A parallel round in the rail: the sibling attempts that share one `groupId` hang under a single header. */

import type { TaskRow } from "rove-bridge/protocol"

/** The ` #i/N` a round's attempts add to the shared title (`planRound`). */
const ORDINAL = /\s+#\d+\/\d+$/

/** Creation order, as the Compare page lists a round (`attemptsOf`): `#i/N` follows it. */
const byCreated = (a: TaskRow, b: TaskRow): number =>
  (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id)

/** A round's key: its `groupId` on its machine; null for a task outside any round (a main row never joins one). */
export const roundKey = (task: TaskRow): string | null =>
  task.groupId && task.kind !== "main" ? `${task.machine?.id ?? ""}\0${task.groupId}` : null

/**
 * The rounds among `siblings` (rows with one parent), each with its attempts in list order. A lone attempt
 * (the others archived, filtered out or gone) is no round and draws as a plain row.
 */
export function roundsAmong(siblings: readonly TaskRow[]): Map<string, TaskRow[]> {
  const rounds = new Map<string, TaskRow[]>()
  for (const task of siblings) {
    const key = roundKey(task)
    if (key === null) continue
    const members = rounds.get(key)
    if (members) members.push(task)
    else rounds.set(key, [task])
  }
  for (const [key, members] of rounds) {
    if (members.length < 2) rounds.delete(key)
    else members.sort(byCreated)
  }
  return rounds
}

/** The round's title: the shared prompt's title, as the first attempt (members in creation order) carries it without its ordinal. */
export function roundTitle(members: readonly TaskRow[]): string {
  return (members[0]?.label ?? "").replace(ORDINAL, "")
}

/** Each attempt's rail label: its engine's name, numbered only where several attempts share an engine (`Codex #2`). */
export function attemptLabels(members: readonly TaskRow[]): Map<string, string> {
  const name = (task: TaskRow): string => task.engine?.name ?? task.label
  const total = new Map<string, number>()
  for (const task of members) total.set(name(task), (total.get(name(task)) ?? 0) + 1)
  const seen = new Map<string, number>()
  return new Map(
    members.map((task) => {
      const base = name(task)
      const nth = (seen.get(base) ?? 0) + 1
      seen.set(base, nth)
      return [task.id, (total.get(base) ?? 0) > 1 ? `${base} #${nth}` : base]
    }),
  )
}

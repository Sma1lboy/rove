/** What git says about each file, as the Files tree shows it: a colour and a letter per file, a colour per directory. */

import type { DiffFileRow } from "rove-bridge/protocol"
import type { Tone } from "./ui/tone.ts"

/** Weakest first: a directory takes the last of these found under it. */
const STRENGTH = ["renamed", "added", "untracked", "modified", "deleted", "conflict"] as const
export type FileState = (typeof STRENGTH)[number]

const OF_CODE: Readonly<Record<string, FileState>> = {
  U: "conflict",
  D: "deleted",
  M: "modified",
  T: "modified",
  "?": "untracked",
  A: "added",
  R: "renamed",
  C: "renamed",
}

export const STATE_TONE: Readonly<Record<FileState, Tone>> = {
  conflict: "attention",
  deleted: "attention",
  modified: "warning",
  untracked: "success",
  added: "success",
  renamed: "accent",
}

export const STATE_LETTER: Readonly<Record<FileState, string>> = {
  conflict: "!",
  deleted: "D",
  modified: "M",
  untracked: "U",
  added: "A",
  renamed: "R",
}

/**
 * `diff.files` rows → a state per file path and per directory (keys ending in `/`, as the tree names them).
 * An uncommitted state beats a committed one for the same file; a directory takes its strongest descendant.
 */
export function treeStates(rows: readonly DiffFileRow[]): Map<string, FileState> {
  const files = new Map<string, FileState>()
  // Branch rows first: the working row of the same file overwrites them.
  for (const scope of ["branch", "working"] as const) {
    for (const row of rows) {
      const state = row.scope === scope ? OF_CODE[row.status] : undefined
      if (state) files.set(row.path, state)
    }
  }
  const out = new Map(files)
  for (const [path, state] of files) {
    for (let at = path.indexOf("/"); at >= 0; at = path.indexOf("/", at + 1)) {
      const dir = path.slice(0, at + 1)
      const seen = out.get(dir)
      if (seen === undefined || STRENGTH.indexOf(state) > STRENGTH.indexOf(seen)) out.set(dir, state)
    }
  }
  return out
}

/** Whether the file has an uncommitted change that has a diff to show (an untracked file is all new: its content is its diff). */
export function hasWorkingDiff(rows: readonly DiffFileRow[], path: string): boolean {
  return rows.some((row) => row.scope === "working" && row.path === path && row.status !== "?")
}

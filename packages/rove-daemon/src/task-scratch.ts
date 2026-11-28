/**
 * Ungrouped (No folder) predicates. `noProject` is the one stored flag; a legacy `scratch` field is
 * mapped onto it by the store codec and the wire readers, and nothing writes `scratch` any more
 * (`test/architecture/scratch-predicates.test.ts` enforces it).
 */

interface UngroupedFlags {
  readonly kind?: string
  readonly noProject?: boolean
  readonly title?: string
}

/** Sits in the sidebar's single Ungrouped group; only an explicit move takes it out. */
export const isUngrouped = (task: UngroupedFlags): boolean => task.kind === "dir" && task.noProject === true

/** An Ungrouped session nobody has named yet: it shows its path and auto-title names it from its own conversation. */
export const isUnnamedUngrouped = (task: UngroupedFlags): boolean => isUngrouped(task) && !task.title

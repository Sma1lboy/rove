/**
 * The only readers and writers of a task's `scratch` flag (outside the store codec and the wire
 * serializers; `test/architecture/scratch-predicates.test.ts` enforces it). `scratch` marks a
 * throwaway session; `noProject` alone decides grouping once a session stops being throwaway.
 */

interface ScratchFlags {
  readonly kind?: string
  readonly scratch?: boolean
  readonly noProject?: boolean
}

/** Throwaway: its row is deleted when its shell exits, a cd into a repo with an agent adopts it, and it stays untitled. */
export const isEphemeral = (task: Pick<ScratchFlags, "scratch">): boolean => task.scratch === true

/** Sits in the sidebar's single Ungrouped group instead of a project. */
export const isUngrouped = (task: ScratchFlags): boolean =>
  task.kind === "dir" && (task.scratch === true || task.noProject === true)

/** A rename keeps the session: no longer throwaway, but still Ungrouped, not regrouped by its cwd. */
export const KEEP_SESSION = { scratch: false, noProject: true } as const

/** The session now belongs to a project (adopted or moved there). */
export const SETTLE_IN_PROJECT = { scratch: false } as const

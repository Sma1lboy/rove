/** What the `task.checkpoint*` / `task.rewind` RPCs answer (git side: rove `orchestrator/worktree/checkpoint.ts`). */

export interface CheckpointRecord {
  readonly n: number
  readonly ref: string
  readonly commit: string
  /** The tree the working tree had; two checkpoints with one tree hold identical files. */
  readonly tree: string
  readonly at: string
  readonly tabId?: string
}

export type TakeCheckpointResult =
  | {
      readonly created: true
      readonly checkpoint: CheckpointRecord
      /** Paths NOT captured: nested repos / submodules, staged as a bare gitlink SHA. */
      readonly uncaptured: readonly string[]
    }
  | { readonly created: false; readonly checkpoint: CheckpointRecord }

export interface RewindResult {
  readonly target: CheckpointRecord
  /** The checkpoint of the state before the rewind — `rewind --to <undo.n>` goes back. */
  readonly undo: CheckpointRecord
  readonly uncaptured: readonly string[]
}

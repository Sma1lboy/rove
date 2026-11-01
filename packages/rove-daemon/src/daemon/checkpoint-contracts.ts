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

/** The orchestrator's checkpoint surface; `DaemonOrchestrator` extends it. */
export interface CheckpointOrchestrator {
  /** Whether the task's workspace takes checkpoints: its owner is a managed task (not main/dir) with a materialised tree. */
  canCheckpoint(id: string): boolean
  /**
   * Checkpoints belong to the workspace owner: `ownerId` is the task whose id keys them (a shared child resolves to
   * its owner), `sharerIds` every live task in that workspace, owner first.
   */
  checkpointScope(id: string): { ownerId: string; sharerIds: string[] }
  /** Snapshot the working tree under the owner's id; `created: false` when it equals the latest checkpoint. Throws `NOT_CHECKPOINTABLE` when {@link canCheckpoint} is false. */
  takeCheckpoint(id: string, opts?: { tabId?: string }): Promise<TakeCheckpointResult>
  listCheckpoints(id: string): Promise<CheckpointRecord[]>
  /** Files-only rewind to checkpoint `n`, after checkpointing the current state (`undo`). */
  rewindToCheckpoint(id: string, n: number): Promise<RewindResult>
  /** Copy the owner's git branch into its host repo; `EXPORT_UNSUPPORTED` when the branch already lives there. */
  exportBranch(id: string): Promise<{ branch: string; commit: string }>
}

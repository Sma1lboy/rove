/**
 * The shape of a `createTask` call.
 *
 * Split from `core.ts` at the file-size cap. A pure input type with no
 * dependency on the Orchestrator class, so it moves cleanly and gives every
 * caller a smaller thing to read than the whole orchestrator.
 */

import type { ProjectIntent } from "../state/project-eligibility.ts"
import type { TaskDispatcher, TaskRoutineLink, VendorId } from "../types/task.ts"

/** Input to {@link Orchestrator.createTask}. */
export interface CreateTaskInput {
  readonly repo: string
  /** Title for the sidebar row. Defaults to `(new task)` when omitted. */
  readonly title?: string
  /** Branch override; otherwise an auto branch is generated lazily. */
  readonly branch?: string
  /** Optional base ref for the new lazy worktree branch. */
  readonly baseRef?: string
  /** Engine PROTOCOL for the monitor's history-reader hint (derived from
   *  {@link command} when the caller passed one). */
  readonly vendor?: VendorId
  /** Raw engine launch command (`add --command`), recorded verbatim. */
  readonly command?: string
  /** Reasoning/effort level for the engine, when the vendor supports one. */
  readonly modelEffort?: string
  /** Fan-out round marker shared by all siblings of one fan-out call. */
  readonly groupId?: string
  /** The kobe session (task + tab) dispatching this create, when one is. */
  readonly dispatcher?: TaskDispatcher
  /** Marks this the standing session task of a routine (issue #91): the
   *  sidebar folds it behind a count row instead of a loose task row. */
  readonly routine?: TaskRoutineLink
  /**
   * How the repo was chosen, for the project-admission gate
   * (state/project-eligibility.ts). Defaults to `"explicit"`: every caller
   * today reaches here from a user naming the repo — the new-task dialog,
   * `rove api add`, a quick-fork of the row you are on. A caller that
   * INFERRED the repo (a script walking directories, a fixture harness)
   * should pass `"derived"` to get the stricter gate.
   */
  readonly projectIntent?: ProjectIntent
}

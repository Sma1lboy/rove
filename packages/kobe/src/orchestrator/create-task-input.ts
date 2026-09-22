/**
 * The shape of a `createTask` call. Its own module so the dependency runs one
 * way: it imports nothing from the Orchestrator class.
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
  /**
   * Directory name for the lazy worktree instead of the animal pool. Refused
   * (not suffixed) when already in use in this repo, since the caller means to
   * predict the path. Single task only, like {@link branch}.
   */
  readonly worktreeName?: string
  /** Engine PROTOCOL for the monitor's history-reader hint (derived from
   *  {@link command} when the caller passed one). */
  readonly vendor?: VendorId
  /** Raw engine launch command (`add --command`), recorded verbatim. */
  readonly command?: string
  /** Reasoning/effort level for the engine, when the vendor supports one. */
  readonly modelEffort?: string
  /** Model pinned on the engine, in its own spelling (`Task.model`). */
  readonly model?: string
  /** The auto-routing tier the engine fields were filled from (`Task.tier`). */
  readonly tier?: string
  /** Fan-out round marker shared by all siblings of one fan-out call. */
  readonly groupId?: string
  /** The kobe session (task + tab) dispatching this create, when one is. */
  readonly dispatcher?: TaskDispatcher
  /** Marks this the standing session task of a routine: the
   *  sidebar folds it behind a count row instead of a loose task row. */
  readonly routine?: TaskRoutineLink
  /**
   * How the repo was chosen, for the project-admission gate
   * (state/project-eligibility.ts). Defaults to `"explicit"` (a user named the
   * repo: new-task dialog, `rove api add`, quick-fork). A caller that INFERRED
   * the repo (directory walker, fixture harness) should pass `"derived"` for
   * the stricter gate.
   */
  readonly projectIntent?: ProjectIntent
}

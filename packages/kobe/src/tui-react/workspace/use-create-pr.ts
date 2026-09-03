/**
 * Create-PR action (FileTree `pr` chip + prefix+p) — a PTY paste+submit of
 * the PR prompt into the selected task's engine session. Its own module
 * because of the guard below, which is the whole hazard: after an await, the
 * selected task (and the TerminalTabs mount behind the ref) may have changed,
 * and a stale continuation must not deliver into the new task. Same guard as
 * the other imperative-ref actions in `host.tsx`, kept where it can be read in
 * one screen.
 *
 * `createPRAction` is the React-free core (git IO injectable) so vitest can
 * pin the target-branch toast and both identity guards without a repo;
 * `useCreatePR` binds it to the live locale.
 */

import type { MutableRefObject } from "react"
import { buildPRPrompt, gatherPRPromptState } from "../../tui/ops/pr-prompt"
import { useT } from "../i18n"

export type CreatePRDeps = {
  worktree: string | null
  sendToEngineFn: MutableRefObject<((text: string) => void) | null>
  selectedWorktreeRef: { readonly current: string | null }
  notifyError: (message: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
  /** Injectable for tests; default to the real git-backed helpers. */
  gather?: typeof gatherPRPromptState
  build?: typeof buildPRPrompt
}

export function createPRAction(deps: CreatePRDeps): () => Promise<void> {
  const gather = deps.gather ?? gatherPRPromptState
  const build = deps.build ?? buildPRPrompt
  /** On the target branch (a project main session) it toasts instead. */
  return async function createPR(): Promise<void> {
    const wt = deps.worktree
    const send = deps.sendToEngineFn.current
    if (!wt || !send) return
    const state = await gather(wt)
    if (state.branch === state.targetBranch)
      return deps.notifyError(deps.t("files.toast.prOnTargetBranch", { branch: state.branch }))
    const prompt = await build(wt, state)
    if (deps.selectedWorktreeRef.current !== wt || deps.sendToEngineFn.current !== send) return
    send(prompt)
  }
}

/**
 * "Create a PR for THAT task" — the sidebar-row aim of `prefix+p`, held
 * across the task switch it needs.
 *
 * The action can only run where the engine is: `sendToEngineFn` is handed up
 * by the mounted TerminalTabs, so a row that is not the active task has no
 * send closure to reach. The host therefore activates the row and parks the
 * request here; the next `onEngineSendReady` for that task claims it. Same
 * shape as the sidebar menu's `requestNewTab`, kept in this module because
 * the action is what it is about.
 *
 * One slot: a second press before the first is claimed retargets it rather
 * than queueing, which is what a user pressing the chord twice means.
 */
let pendingCreatePR: string | null = null

export function requestCreatePR(taskId: string): void {
  pendingCreatePR = taskId
}

/** Claim a parked request for this task. */
export function takeCreatePR(taskId: string | null): boolean {
  if (taskId === null || pendingCreatePR !== taskId) return false
  pendingCreatePR = null
  return true
}

export function useCreatePR(args: Omit<CreatePRDeps, "t" | "gather" | "build">): () => Promise<void> {
  const t = useT()
  return createPRAction({ ...args, t })
}

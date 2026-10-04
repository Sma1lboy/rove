/**
 * Create-PR (FileTree `pr` chip + prefix+p): PTY paste+submit of the PR prompt
 * into the selected task's engine. The hazard is identity: after an await the
 * selected task (and the mount behind the ref) may have changed, and a stale
 * continuation must not deliver into the new task. `createPRAction` is the
 * React-free core (git IO injectable, vitest-able); `useCreatePR` binds the locale.
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
  /** Injectable for tests; defaults to the real git helpers. */
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
 * `prefix+p` aimed at a sidebar row: a non-active row has no send closure, so
 * the host activates it and parks the request here; the next
 * `onEngineSendReady` for that task claims it. One slot: a second press before
 * the claim retargets rather than queues.
 */
let pendingCreatePR: string | null = null

export function requestCreatePR(taskId: string): void {
  pendingCreatePR = taskId
}

export function takeCreatePR(taskId: string | null): boolean {
  if (taskId === null || pendingCreatePR !== taskId) return false
  pendingCreatePR = null
  return true
}

export function useCreatePR(args: Omit<CreatePRDeps, "t" | "gather" | "build">): () => Promise<void> {
  const t = useT()
  return createPRAction({ ...args, t })
}

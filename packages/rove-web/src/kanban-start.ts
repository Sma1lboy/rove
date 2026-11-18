/**
 * Story → engine session, sequenced from bridge atoms the way the TUI's `use-issue-chat.ts`
 * does it: `worktree` makes the story's task and links the issue (the link moves the card to
 * In progress); `project` starts a session of its own in the project's checkout and flips the
 * story to `doing`. A link or status refusal is reported but never strands a session that is running.
 */

import type { BridgeClient } from "./bridge.ts"
import { startInCheckout } from "./new-session.ts"
import { errorMessage } from "./pages-kit.ts"

export type Placement = "worktree" | "project"
/** The TUI drawer's order: the isolated task first. */
export const PLACEMENTS: readonly Placement[] = ["worktree", "project"]

export interface StoryRef {
  readonly id: number
  readonly title: string
}

export interface StartRequest {
  readonly repo: string
  readonly issue: StoryRef
  readonly engine: string
  readonly placement: Placement
}

export interface StartResult {
  /** The session's task. */
  readonly taskId: string
  /** Best-effort steps that failed after the session was running. */
  readonly warnings: readonly { readonly kind: "link" | "status"; readonly error: string }[]
}

export async function startStory(client: BridgeClient, req: StartRequest): Promise<StartResult> {
  const where = req.placement === "project" ? "project" : "worktree"
  const { title, prompt } = await client.request<{ title: string; prompt: string }>("issue.prompt", {
    repo: req.repo,
    id: req.issue.id,
    where,
  })
  const warnings: StartResult["warnings"][number][] = []
  if (req.placement !== "project") {
    const { taskId } = await client.request<{ taskId: string }>("task.create", {
      repo: req.repo,
      engine: req.engine,
      title,
      prompt,
    })
    await client
      .request("issue.update", { repo: req.repo, id: req.issue.id, task: taskId })
      .catch((err: unknown) => warnings.push({ kind: "link", error: errorMessage(err) }))
    return { taskId, warnings }
  }
  const taskId = await startInCheckout((op, args) => client.request(op, args), req.repo, req.engine, title, prompt)
  if (!taskId) throw new Error("the session did not start")
  await client
    .request("issue.setStatus", { repo: req.repo, id: req.issue.id, status: "doing" })
    .catch((err: unknown) => warnings.push({ kind: "status", error: errorMessage(err) }))
  return { taskId, warnings }
}

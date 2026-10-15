/**
 * Story → engine session, sequenced from bridge atoms the way the TUI's `use-issue-chat.ts`
 * does it: `worktree` makes the story's task and links the issue (the link moves the card to
 * In progress); `project` runs a new engine tab on the main checkout and flips the story to
 * `doing`. A link or status refusal is reported but never strands a session that is running.
 * `projectWorktree` (the same task, mirrored as a viewport tab in the project workspace) has
 * no bridge op, so the drawer does not offer it.
 */

import type { BridgeClient } from "./bridge.ts"
import { errorMessage } from "./pages-kit.ts"

export type Placement = "worktree" | "project"
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
  /** The task whose workspace holds the session (the story's task, or the main checkout's). */
  readonly taskId: string
  readonly tabId?: string
  /** Best-effort steps that failed after the session was running. */
  readonly warnings: readonly { readonly kind: "link" | "status"; readonly error: string }[]
}

export async function startStory(client: BridgeClient, req: StartRequest): Promise<StartResult> {
  const where = req.placement === "worktree" ? "worktree" : "project"
  const { title, prompt } = await client.request<{ title: string; prompt: string }>("issue.prompt", {
    repo: req.repo,
    id: req.issue.id,
    where,
  })
  const warnings: StartResult["warnings"][number][] = []
  if (req.placement === "worktree") {
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
  const { taskId } = await client.request<{ taskId: string }>("task.openMain", { repo: req.repo })
  const { tabId } = await client.request<{ tabId: string }>("tab.new", {
    taskId,
    kind: "engine",
    engine: req.engine,
    prompt,
  })
  await client
    .request("issue.setStatus", { repo: req.repo, id: req.issue.id, status: "doing" })
    .catch((err: unknown) => warnings.push({ kind: "status", error: errorMessage(err) }))
  return { taskId, tabId, warnings }
}

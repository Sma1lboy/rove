/**
 * Story → engine session, sequenced from bridge atoms the way the TUI's `use-issue-chat.ts`
 * does it: `worktree` makes the story's task and links the issue (the link moves the card to
 * In progress); `project` runs a new engine as a child task of the main checkout (sharing its
 * directory) and flips the story to `doing`. `projectWorktree` is the `worktree` task plus a
 * viewport tab onto its session in the project's workspace (`tab.openViewport`). A link or status
 * refusal is reported but never strands a session that is running.
 */

import type { BridgeClient } from "./bridge.ts"
import { errorMessage } from "./pages-kit.ts"

export type Placement = "worktree" | "projectWorktree" | "project"
/** The TUI drawer's order: the isolated task first. */
export const PLACEMENTS: readonly Placement[] = ["worktree", "projectWorktree", "project"]

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
    if (req.placement === "worktree") return { taskId, warnings }
    // The story's session also appears in the project workspace; jumping lands there.
    const main = await client.request<{ taskId: string }>("task.openMain", { repo: req.repo })
    const view = await client.request<{ tabId: string }>("tab.openViewport", {
      taskId: main.taskId,
      viewTaskId: taskId,
    })
    return { taskId: main.taskId, tabId: view.tabId, warnings }
  }
  const { taskId: mainTaskId } = await client.request<{ taskId: string }>("task.openMain", { repo: req.repo })
  // The session is a child task of the main checkout, sharing its directory, not a second tab on it.
  const { tabId, taskId = mainTaskId } = await client.request<{ tabId: string; taskId?: string }>("tab.new", {
    taskId: mainTaskId,
    kind: "engine",
    engine: req.engine,
    prompt,
  })
  await client
    .request("issue.setStatus", { repo: req.repo, id: req.issue.id, status: "doing" })
    .catch((err: unknown) => warnings.push({ kind: "status", error: errorMessage(err) }))
  return { taskId, tabId, warnings }
}

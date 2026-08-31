/**
 * Client for `/api/worktrees` — the standalone worktree-management page.
 * See `packages/kobe-daemon/src/daemon/web-worktrees-route.ts` for the
 * server side. `DirtyWorktreeError` distinguishes "refused: dirty" from any
 * other delete failure so the page knows when to offer a force-confirm.
 */

import { ApiError, api } from "./api-client.ts"

export interface WorktreeRow {
  path: string
  branch: string
  head: string
  dirty: boolean
  kobeManaged: boolean
  lastActivityMs: number
  repo: string
  createdAtMs: number
  branchOnRemote: boolean | null
}

export interface WorktreeProject {
  repo: string
  worktrees: WorktreeRow[]
}

export class DirtyWorktreeError extends Error {}

export async function fetchWorktreeProjects(): Promise<WorktreeProject[]> {
  const data = await api.get<{ projects?: unknown }>("/api/worktrees", {
    label: "load worktrees",
  })
  return Array.isArray(data.projects)
    ? (data.projects as WorktreeProject[])
    : []
}

/** A directory a removal left behind after git had already deregistered the
 *  worktree. Reported, never deleted by Rove. */
export interface WorktreeResidue {
  path: string
  reason: string
}

export async function removeWorktree(
  path: string,
  force: boolean,
): Promise<WorktreeResidue | null> {
  try {
    const res = await api.delete<{ removed: boolean; residue?: WorktreeResidue }>(
      "/api/worktrees",
      { path, force },
      { label: "delete worktree" },
    )
    return res.residue ?? null
  } catch (err) {
    if (
      err instanceof ApiError &&
      /refusing to remove dirty worktree/.test(err.detail)
    ) {
      throw new DirtyWorktreeError(err.detail)
    }
    throw err
  }
}

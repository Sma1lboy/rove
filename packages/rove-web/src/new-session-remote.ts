/** Pure rules of starting a task from the New session composer on another registered machine: which repo value Start sends, and when that machine has to clone it first. */

import { deriveTitleFromPrompt } from "@sma1lboy/rove/src/orchestrator/title.ts"
import { splitRepoRow } from "./new-task-paths.ts"

/** One row of the bridge's `machines.repos`: a repo on that machine, by id. */
export interface RemoteRepo {
  /** `host/owner/name`, or `root:<sha>` for a repo with no origin. */
  readonly id: string
  readonly primary: string | null
  readonly checkouts: readonly string[]
}

/** The project picked on another machine: what `task.spawn` takes as `repo` (it is also the menu row's key), and whether that machine must clone it. */
export interface RemotePick {
  readonly ref: string
  readonly clone: boolean
}

/**
 * What names a listed repo to that machine's `add`: its id, except a repo with no origin, which has no id `add`
 * can resolve and so goes by that machine's own checkout path.
 */
export function remoteRef(repo: RemoteRepo): string {
  if (!repo.id.startsWith("root:")) return repo.id
  return repo.primary ?? repo.checkouts[0] ?? repo.id
}

/**
 * The pick a seed (the project a rail row opened the composer on) stands for: the listed repo whose id or
 * checkout it is, else an absolute path on that machine, else nothing.
 */
export function seedRemotePick(seed: string | undefined, repos: readonly RemoteRepo[]): RemotePick | null {
  if (!seed) return null
  const hit = repos.find((repo) => repo.id === seed || repo.checkouts.includes(seed))
  if (hit) return { ref: remoteRef(hit), clone: false }
  return seed.startsWith("/") ? { ref: seed, clone: false } : null
}

/**
 * Whether a GitHub repo is already on the machine the project list shows. Locally a repo whose name matches a
 * saved project's folder is taken to be that clone; another machine's rows are ids, matched whole.
 */
export function githubRepoHeld(held: readonly string[], nameWithOwner: string, remote: boolean): boolean {
  const name = nameWithOwner.toLowerCase()
  if (remote) return held.some((id) => id.toLowerCase() === `github.com/${name}`)
  return held.some((path) => splitRepoRow(path).base.toLowerCase() === (name.split("/")[1] ?? ""))
}

export interface RemoteStartInput {
  readonly pick: RemotePick
  readonly machine: string
  readonly engine: string
  readonly prompt: string
  /** false: create the task without running its engine. */
  readonly begin: boolean
  /** The ref its worktree branches from; "" = that repo's current branch. */
  readonly baseRef: string
}

/**
 * The `task.spawn` args for Start on another machine. Its engine, model list and checkout are its own,
 * so only the engine id (that machine's `add` validates it) rides along, never a model or effort.
 */
export function remoteSpawnArgs(input: RemoteStartInput): Record<string, unknown> {
  const title = input.begin ? "" : deriveTitleFromPrompt(input.prompt)
  return {
    repo: input.pick.ref,
    machine: input.machine,
    ...(input.pick.clone ? { clone: true } : {}),
    ...(input.baseRef ? { baseBranch: input.baseRef } : {}),
    ...(input.begin && input.prompt ? { prompt: input.prompt } : {}),
    ...(title ? { title } : {}),
    ...(input.engine ? { engine: input.engine } : {}),
  }
}

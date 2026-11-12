/** Pure rules of starting a task from the New session composer on another registered machine: which repo value Start sends, and when that machine has to clone it first. */

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

/** A clone pick as the chip names it: `owner/repo`, the last two segments of its id, shorthand or git URL. */
export function cloneLabel(ref: string): string {
  return ref
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .filter(Boolean)
    .slice(-2)
    .join("/")
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

/**
 * The pick on the machine switched to for the project picked before the switch: `ref` is that pick (a path, id
 * or clone source) and `from` its machine's list. The same repo's checkout where the new machine has one, else
 * a clone of it there; nothing for a repo with no origin, which only its own machine has.
 */
export function carriedPick(ref: string, from: readonly RemoteRepo[], to: readonly RemoteRepo[]): RemotePick | null {
  const id = from.find((repo) => repo.id === ref || repo.checkouts.includes(ref))?.id ?? ref
  const hit = to.find((repo) => repo.id === id)
  if (hit) return { ref: remoteRef(hit), clone: false }
  return id.startsWith("root:") || id.startsWith("/") ? null : { ref: id, clone: true }
}

/** One row of the bridge's `machines.engines`. */
export interface RemoteEngine {
  readonly id: string
  readonly name?: string
  readonly installed?: boolean
}

/**
 * The engine chip's rows on another machine: this machine's offered engines, then the ones only that machine
 * has; `missing` are the rows it cannot launch. An empty `there` (it has not answered, or cannot say) gates nothing.
 */
export function enginesThere<E extends { readonly id: string; readonly name: string }>(
  here: readonly E[],
  there: readonly RemoteEngine[],
): {
  readonly rows: ReadonlyArray<E | { readonly id: string; readonly name: string }>
  readonly missing: ReadonlySet<string>
} {
  const usable = new Set(there.filter((e) => e.installed !== false).map((e) => e.id))
  const missing = new Set(there.length > 0 ? here.filter((e) => !usable.has(e.id)).map((e) => e.id) : [])
  const known = new Set(here.map((e) => e.id))
  const extra = there
    .filter((e) => usable.has(e.id) && !known.has(e.id))
    .map((e) => ({ id: e.id, name: e.name ?? e.id }))
  return { rows: [...here, ...extra], missing }
}

export interface RemoteStartInput {
  readonly pick: RemotePick
  readonly machine: string
  readonly engine: string
  readonly prompt: string
  /** The ref its worktree branches from; "" = that repo's current branch. */
  readonly baseRef: string
  /** Run the engine on that machine too. Off: the agent is this machine's and only the work is there. */
  readonly engineThere: boolean
  /** This machine's model for the agent; "" = the engine's default. Not sent with `engineThere`. */
  readonly model: string
}

/**
 * The `task.spawn` args for Start on another machine. The agent is this machine's, so its engine and model
 * ride along. With `engineThere` the engine, model list and checkout are that machine's own: only
 * the engine id (its `add` validates it) rides along, never a model.
 */
export function remoteSpawnArgs(input: RemoteStartInput): Record<string, unknown> {
  return {
    repo: input.pick.ref,
    machine: input.machine,
    ...(input.pick.clone ? { clone: true } : {}),
    ...(input.baseRef ? { baseBranch: input.baseRef } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.engine ? { engine: input.engine } : {}),
    ...(input.engineThere ? { engineThere: true } : {}),
    ...(!input.engineThere && input.model ? { model: input.model } : {}),
  }
}

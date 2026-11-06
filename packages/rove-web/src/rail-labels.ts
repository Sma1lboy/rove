/** A project's header label: the narrowest name that tells it apart from the other projects on screen. */

export const repoLabel = (repo: string): string => repo.split("/").filter(Boolean).pop() ?? repo

/** What a label rule reads of a project. */
interface Labelled {
  readonly repo: string
  readonly repoId?: string | undefined
}

/** A repo as the label rules see it: its path plus the host it lives on (`""` = this Mac). */
export interface LabelledRepo {
  readonly repo: string
  readonly host: string
}

/**
 * `groups.ts` `sidebarProjectLabel` (not importable here: `@/` paths): the narrowest unique header label.
 * A basename unique on screen reads `rove`; shared on one machine, the last two segments (`gihub/rove`);
 * shared only with another machine, `host:basename` (`narwhal:rove`), the local one keeping the bare name.
 */
export function projectLabel(repo: string, repos: readonly LabelledRepo[], host = ""): string {
  const base = repoLabel(repo)
  const collisions = repos.filter(
    (entry) => (entry.repo !== repo || entry.host !== host) && repoLabel(entry.repo) === base,
  )
  if (collisions.length === 0) return base
  const tailOf = (path: string) => path.split("/").filter(Boolean).slice(-2).join("/")
  if (collisions.some((entry) => entry.host === host)) {
    const tailRepeats = collisions.some((entry) => entry.host !== host && tailOf(entry.repo) === tailOf(repo))
    return tailRepeats && host ? `${host}:${tailOf(repo)}` : tailOf(repo)
  }
  return host ? `${host}:${base}` : base
}

/** `owner/name` of a `host/owner/name` id; a `root:` id has no readable name. */
const repoIdTail = (id: string): string | null => (id.startsWith("root:") ? null : id.split("/").slice(-2).join("/"))

/**
 * The repo's basename, widened only when a DIFFERENT project shares it: a repo id reads `owner/name`
 * (the whole id when even that repeats), a path-only project its path tail ({@link projectLabel} with
 * every checkout as one host): the header never names a machine, the rows' cloud marks do.
 */
export function mergedLabel(project: Labelled, all: readonly Labelled[]): string {
  const base = repoLabel(project.repo)
  const others = all.filter((other) => other !== project && repoLabel(other.repo) === base)
  if (others.length === 0) return base
  const id = project.repoId
  const tail = id ? repoIdTail(id) : null
  if (id && tail) {
    return others.some((other) => other.repoId && other.repoId !== id && repoIdTail(other.repoId) === tail) ? id : tail
  }
  return projectLabel(
    project.repo,
    [project, ...others].map((entry) => ({ repo: entry.repo, host: "" })),
  )
}

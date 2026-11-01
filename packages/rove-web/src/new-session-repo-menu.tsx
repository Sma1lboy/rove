/** The composer's project popover: Ungrouped (no project; on this machine), saved projects (or another machine's), a typed path, and "Clone" for a typed git URL, `owner/repo` or one of the user's GitHub repos. */

import { useEffect, useState } from "react"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { SearchList } from "./new-session-menus.tsx"
import { githubRepoHeld } from "./new-session-remote.ts"
import {
  cloneSource,
  expandTilde,
  filterText,
  isPathInput,
  splitRepoRow,
  stripTrailingSlash,
} from "./new-task-paths.ts"
import { NO_PROJECT_KEY } from "./rail.ts"
import { lastReply, requestRemembered } from "./remembered.ts"

interface GithubRepos {
  readonly repos: ReadonlyArray<{ nameWithOwner: string; description: string; isPrivate: boolean }>
  readonly reason?: string
}

/** Row keys that mean "clone this" rather than a project path. */
export const CLONE_PREFIX = "clone:"

export function RepoMenu(props: {
  model: AppModel
  /** This machine's project paths, or with `remote` that machine's repo ids. */
  saved: readonly string[]
  picked: readonly string[]
  primary: string
  home: string
  query: string
  onQuery: (value: string) => void
  onToggle: (path: string) => void
  onClone: (source: string) => void
  close: () => void
  /** Another machine: its name, what an empty list says (still loading, or why it could not be read), and `blocked` when it could not be read: nothing is offered on it, only that reason. */
  remote?: { readonly name: string; readonly empty: string; readonly blocked: boolean }
  /** This machine only: a session in no project (the rail's Ungrouped), exclusive with the repo picks. */
  ungrouped?: { readonly on: boolean; readonly pick: () => void }
}) {
  const { model, saved, picked, primary, home, query, remote } = props
  // The popover mounts this when it opens: the last list shows at once, reread then, and the rows never wait on it.
  const [github, setGithub] = useState<GithubRepos | null>(() => lastReply<GithubRepos>(model, "github.repos") ?? null)
  useEffect(() => {
    let stale = false
    requestRemembered<GithubRepos>(model, "github.repos")
      .then((res) => !stale && setGithub(res))
      .catch(() => !stale && setGithub({ repos: [], reason: "failed" }))
    return () => {
      stale = true
    }
  }, [model])

  const typed = query.trim()
  const local = filterText(saved, query)
  const noFolder = t("rail.noProject")
  const ungrouped =
    props.ungrouped && (!typed || noFolder.toLowerCase().includes(typed.toLowerCase()))
      ? [{ key: NO_PROJECT_KEY, text: noFolder, dim: home, checked: props.ungrouped.on }]
      : []
  const projects = local.map((path) => {
    const { base, dir } = splitRepoRow(path)
    return {
      key: path,
      text: base,
      dim: path === primary && picked.length > 1 ? `${t("newSession.primary")}, ${dir}` : dir,
      checked: picked.includes(path),
    }
  })
  // A shorthand that already names a saved project is a search, not a clone; a URL never is.
  const source = cloneSource(typed)
  const clone = source && (source.includes(":") || local.length === 0) ? source : null
  const typedPath =
    !clone && isPathInput(typed) && !saved.includes(typed) && (!remote || typed.startsWith("/"))
      ? stripTrailingSlash(expandTilde(typed, home))
      : ""
  const extra = clone
    ? {
        key: CLONE_PREFIX + clone,
        text: remote
          ? t("newSession.cloneRowOn", { source: clone, machine: remote.name })
          : t("newSession.cloneRow", { source: clone }),
      }
    : typedPath
      ? { key: typedPath, text: typedPath, checked: picked.includes(typedPath) }
      : null
  const needle = typed.toLowerCase()
  const more = (github?.repos ?? [])
    .filter((repo) => repo.nameWithOwner.toLowerCase().includes(needle))
    .filter((repo) => !githubRepoHeld(saved, repo.nameWithOwner, remote !== undefined))
    .map((repo) => ({
      key: CLONE_PREFIX + repo.nameWithOwner,
      text: repo.nameWithOwner,
      dim: repo.description,
      title: repo.description,
    }))

  return (
    // A check-list: a pick toggles and the list stays open, so several repos go in one visit.
    <SearchList
      placeholder={t(remote ? "newSession.repoSearchRemote" : "newSession.repoSearch")}
      empty={remote?.empty ?? t("newSession.repoEmpty")}
      rows={remote?.blocked ? [] : [...ungrouped, ...projects]}
      query={query}
      onQuery={props.onQuery}
      extra={remote?.blocked ? null : extra}
      more={remote?.blocked ? [] : more}
      moreLabel={t("newSession.githubGroup")}
      onPick={(key) => {
        if (key === NO_PROJECT_KEY) {
          props.ungrouped?.pick()
          return props.close()
        }
        if (!key.startsWith(CLONE_PREFIX)) return props.onToggle(key)
        props.onClone(key.slice(CLONE_PREFIX.length))
        props.close()
      }}
    />
  )
}

/** The composer's project popover: saved projects, a typed path, and "Clone" for a typed git URL, `owner/repo` or one of the user's GitHub repos. */

import { useEffect, useState } from "react"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { SearchList } from "./new-session-menus.tsx"
import {
  cloneSource,
  expandTilde,
  filterText,
  isPathInput,
  splitRepoRow,
  stripTrailingSlash,
} from "./new-task-paths.ts"

interface GithubRepos {
  readonly repos: ReadonlyArray<{ nameWithOwner: string; description: string; isPrivate: boolean }>
  readonly reason?: string
}

/** Row keys that mean "clone this" rather than a project path. */
export const CLONE_PREFIX = "clone:"

export function RepoMenu(props: {
  model: AppModel
  saved: readonly string[]
  picked: readonly string[]
  primary: string
  home: string
  query: string
  onQuery: (value: string) => void
  onToggle: (path: string) => void
  onClone: (source: string) => void
  close: () => void
}) {
  const { model, saved, picked, primary, home, query } = props
  // The popover mounts this when it opens, so the list is fetched then and the rows never wait on it.
  const [github, setGithub] = useState<GithubRepos | null>(null)
  useEffect(() => {
    let stale = false
    model.client
      .request<GithubRepos>("github.repos")
      .then((res) => !stale && setGithub(res))
      .catch(() => !stale && setGithub({ repos: [], reason: "failed" }))
    return () => {
      stale = true
    }
  }, [model])

  const typed = query.trim()
  const local = filterText(saved, query)
  const rows = local.map((path) => {
    const { base, dir } = splitRepoRow(path)
    return {
      key: path,
      text: base,
      dim: path === primary && picked.length > 1 ? `${t("newSession.primary")} · ${dir}` : dir,
      checked: picked.includes(path),
    }
  })
  // A shorthand that already names a saved project is a search, not a clone; a URL never is.
  const source = cloneSource(typed)
  const clone = source && (source.includes(":") || local.length === 0) ? source : null
  const typedPath =
    !clone && isPathInput(typed) && !saved.includes(typed) ? stripTrailingSlash(expandTilde(typed, home)) : ""
  const extra = clone
    ? { key: CLONE_PREFIX + clone, text: t("newSession.cloneRow", { source: clone }) }
    : typedPath
      ? { key: typedPath, text: typedPath, checked: picked.includes(typedPath) }
      : null
  // A GitHub repo whose name matches a saved project's folder is taken to be that clone.
  const have = new Set(saved.map((path) => splitRepoRow(path).base.toLowerCase()))
  const needle = typed.toLowerCase()
  const more = (github?.repos ?? [])
    .filter((repo) => repo.nameWithOwner.toLowerCase().includes(needle))
    .filter((repo) => !have.has(repo.nameWithOwner.split("/")[1]?.toLowerCase() ?? ""))
    .map((repo) => ({
      key: CLONE_PREFIX + repo.nameWithOwner,
      text: repo.nameWithOwner,
      dim: repo.description,
      title: repo.description,
    }))

  return (
    // A check-list: a pick toggles and the list stays open, so several repos go in one visit.
    <SearchList
      placeholder={t("newSession.repoSearch")}
      empty={t("newSession.repoEmpty")}
      rows={rows}
      query={query}
      onQuery={props.onQuery}
      extra={extra}
      more={more}
      moreLabel={t("newSession.githubGroup")}
      onPick={(key) => {
        if (!key.startsWith(CLONE_PREFIX)) return props.onToggle(key)
        props.onClone(key.slice(CLONE_PREFIX.length))
        props.close()
      }}
    />
  )
}

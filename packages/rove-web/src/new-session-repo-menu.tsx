/** The composer's project popover: Ungrouped (no project; on this machine), saved projects (or another machine's), a typed path, and "Clone" for a typed git URL, `owner/repo` or one of the user's GitHub repos. */

import { useEffect, useState } from "react"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { SearchList } from "./new-session-menus.tsx"
import { githubRepoHeld } from "./new-session-remote.ts"
import {
  cloneSource,
  expandTilde,
  githubRepoName,
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
  /** `add`: keep the other picks (a multi-repo task); otherwise this one replaces them. */
  onToggle: (path: string, add: boolean) => void
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
  const needle = typed.toLowerCase()
  // A GitHub URL or `owner/repo` searches by the repo it names, not by its own text.
  const named = githubRepoName(typed)
  const local = saved.filter(
    (path) =>
      path.toLowerCase().includes(needle) ||
      (named !== null && `/${splitRepoRow(path).base.toLowerCase()}` === named.slice(named.indexOf("/"))),
  )
  const noFolder = t("newSession.noFolder")
  const ungrouped =
    props.ungrouped && (!typed || noFolder.toLowerCase().includes(typed.toLowerCase()))
      ? [{ key: NO_PROJECT_KEY, text: noFolder, checked: props.ungrouped.on }]
      : []
  const projects = local.map((path, i) => {
    const { base, dir } = splitRepoRow(path)
    return {
      key: path,
      text: base,
      dim: path === primary && picked.length > 1 ? `${t("newSession.primary")}, ${dir}` : dir,
      dimPath: true,
      title: path,
      checked: picked.includes(path),
      ruled: i === 0 && ungrouped.length > 0,
    }
  })
  // A shorthand that already names a saved project is a search, not a clone; a URL never is.
  const source = cloneSource(typed)
  const clone = source && (source.includes(":") || local.length === 0) ? source : null
  const typedPath =
    !clone && isPathInput(typed) && !saved.includes(typed) && (!remote || typed.startsWith("/"))
      ? stripTrailingSlash(expandTilde(typed, home))
      : ""
  const more = (github?.repos ?? [])
    .filter((repo) => repo.nameWithOwner.toLowerCase().includes(named ?? needle))
    .filter((repo) => !githubRepoHeld(saved, repo.nameWithOwner, remote !== undefined))
    // The repo the text names leads the ones that merely contain it.
    .sort((a, b) => Number(b.nameWithOwner.toLowerCase() === named) - Number(a.nameWithOwner.toLowerCase() === named))
    .map((repo) => ({
      key: CLONE_PREFIX + repo.nameWithOwner,
      text: repo.nameWithOwner,
      dim: repo.description,
      title: repo.description,
    }))
  // The listed repo says what it is; the bare "Clone <text>" row beside it would be the same clone. An ssh URL stays: it picks the protocol.
  const listed = named !== null && !/^(?:ssh:|git@)/i.test(typed) && more[0]?.text.toLowerCase() === named
  const extra = listed
    ? null
    : clone
      ? {
          key: CLONE_PREFIX + clone,
          text: remote
            ? t("newSession.cloneRowOn", { source: clone, machine: remote.name })
            : t("newSession.cloneRow", { source: clone }),
        }
      : typedPath
        ? { key: typedPath, text: typedPath, checked: picked.includes(typedPath) }
        : null

  return (
    // A pick replaces the project and closes; ⌘ / Ctrl + pick toggles it in a multi-repo task and keeps the list open.
    <SearchList
      placeholder={t(remote ? "newSession.repoSearchRemote" : "newSession.repoSearch")}
      empty={remote?.empty ?? t("newSession.repoEmpty")}
      rows={remote?.blocked ? [] : [...ungrouped, ...projects]}
      query={query}
      onQuery={props.onQuery}
      extra={remote?.blocked ? null : extra}
      more={remote?.blocked ? [] : more}
      moreLabel={t("newSession.githubGroup")}
      hint={remote ? undefined : t("newSession.repoMultiHint")}
      onPick={(key, add) => {
        if (key === NO_PROJECT_KEY) {
          props.ungrouped?.pick()
          return props.close()
        }
        if (!key.startsWith(CLONE_PREFIX)) return props.onToggle(key, add)
        props.onClone(key.slice(CLONE_PREFIX.length))
        props.close()
      }}
    />
  )
}

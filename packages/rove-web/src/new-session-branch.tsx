/** The composer's branch chips: the Worktree toggle and where the worktree is cut from (this machine), or the remote's base ref. */

import { useState } from "react"
import { t } from "./i18n/index.ts"
import { BranchIcon } from "./new-session-icons.tsx"
import { RemoteBranchChip } from "./new-session-machine.tsx"
import { BranchesMenu, ChipPopover, SearchList } from "./new-session-menus.tsx"
import type { RemotePick } from "./new-session-remote.ts"
import type { ProbeResult } from "./new-task-dialog.tsx"
import { filterText, splitRepoRow } from "./new-task-paths.ts"
import * as C from "./ui/composer.ts"

export function BranchChips(props: {
  remotePick: RemotePick | null
  remoteBase: string
  onRemoteBase: (ref: string) => void
  remote: boolean
  ungrouped: boolean
  inPlace: boolean
  /** The Worktree toggle. */
  onToggleWorktree: () => void
  repos: readonly string[]
  probes: Readonly<Record<string, ProbeResult>>
  /** The ref each repo's worktree branches from ("" = its current branch). */
  bases: Readonly<Record<string, string>>
  onBase: (path: string, ref: string) => void
  /** The one branch name several repos share. */
  branchName: string
  onBranchName: (name: string) => void
}) {
  const [query, setQuery] = useState("")
  if (props.ungrouped) return null
  if (props.remote) {
    return props.remotePick && <RemoteBranchChip value={props.remoteBase} onPick={props.onRemoteBase} />
  }
  const { repos, bases, inPlace } = props
  const primary = repos[0] ?? ""
  const probe = props.probes[primary] ?? null
  const label = bases[primary] || probe?.current || ""
  const rows = filterText(probe?.branches ?? [], query).map((name) => ({
    key: name,
    text: name,
    checked: name === (bases[primary] || probe?.current),
  }))
  const branchRepos = repos.map((path) => ({
    path,
    name: splitRepoRow(path).base,
    primary: path === primary,
    branches: props.probes[path]?.branches ?? [],
    current: props.probes[path]?.current ?? "",
    base: bases[path] ?? "",
  }))
  return (
    <>
      <button
        type="button"
        className={`${C.chipClass(!inPlace)} ${C.TOGGLE_DISABLED}`}
        aria-pressed={!inPlace}
        disabled={repos.length > 1}
        title={
          repos.length > 1
            ? t("newSession.worktreeMulti")
            : t(inPlace ? "newSession.worktreeOff" : "newSession.worktreeOn")
        }
        onClick={props.onToggleWorktree}
      >
        <BranchIcon />
        {t("newSession.worktree")}
      </button>
      {repos.length > 1 ? (
        <ChipPopover field="branch" title={t("newSession.branches")} label={t("newSession.branches")}>
          {() => (
            <BranchesMenu
              repos={branchRepos}
              branch={props.branchName}
              onBranch={props.onBranchName}
              onBase={props.onBase}
            />
          )}
        </ChipPopover>
      ) : (
        !inPlace &&
        probe?.ok &&
        label && (
          <ChipPopover field="branch" title={t("newSession.branch")} label={label}>
            {(close) => (
              <SearchList
                placeholder={t("newSession.branchSearch")}
                empty={t("newSession.branchEmpty")}
                rows={rows}
                query={query}
                onQuery={setQuery}
                onPick={(name) => {
                  props.onBase(primary, name)
                  setQuery("")
                  close()
                }}
              />
            )}
          </ChipPopover>
        )
      )}
    </>
  )
}

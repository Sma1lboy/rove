/**
 * The Existing tab's "also include" list: the saved repos a task can span besides its primary (the repo
 * field), multi-selected in pick order. State only; JSX is in `./tab-existing.tsx`.
 */

import { samePath } from "@sma1lboy/rove-daemon/path-identity"
import { MULTI_REPO_CAP } from "@sma1lboy/rove-daemon/task-tree"
import { useMemo, useState } from "react"
import {
  type PickerWindow,
  clampCursor,
  computeRepoOptions,
  windowAround,
} from "../../../tui/component/new-task-dialog/state"
import { toggleExtraRepo } from "./pure"

export function useExtraRepos(args: { savedRepos: readonly string[]; primary: string; pickerRows: number }) {
  const [picked, setPicked] = useState<readonly string[]>([])
  const [cursor, setCursor] = useState(0)

  // Every saved repo but the primary. A repo that became the primary drops out of the picks with it.
  const candidates = useMemo(
    () => computeRepoOptions("", args.savedRepos).filter((repo) => !args.primary || !samePath(repo, args.primary)),
    [args.savedRepos, args.primary],
  )
  const chosen = useMemo(() => picked.filter((repo) => candidates.includes(repo)), [picked, candidates])
  const window: PickerWindow = windowAround(candidates, cursor, args.pickerRows)

  function toggleAt(index: number): void {
    const repo = candidates[index]
    if (repo) setPicked(toggleExtraRepo(chosen, repo, MULTI_REPO_CAP - 1))
  }

  return {
    extraCandidates: candidates,
    extraPicked: chosen,
    extraWindow: window,
    extraCursor: cursor,
    moveExtraCursor: (delta: 1 | -1) => {
      if (candidates.length > 0) setCursor((c) => clampCursor(c + delta, candidates.length))
    },
    toggleExtraCursor: () => toggleAt(cursor),
    pickExtraAt: (index: number) => {
      setCursor(index)
      toggleAt(index)
    },
  }
}

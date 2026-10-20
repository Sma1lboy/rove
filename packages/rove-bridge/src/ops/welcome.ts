/**
 * The first-run welcome's one read: what the TUI's `welcome-pane.tsx` probes when no task exists
 * (engines installed and signed in, git on PATH) plus the repo its quick start would use, which
 * the TUI takes from its own working directory. Here that is the directory `rove --web` was
 * started in.
 */

import { basename } from "node:path"
import { detectEngineStatuses, probeableEngineIds, summarizeEngines } from "@sma1lboy/rove/src/engine/engine-status.ts"
import { engineDisplayName } from "@sma1lboy/rove/src/engine/interactive-command.ts"
import { resolveMainRepoRoot } from "@sma1lboy/rove/src/state/repos.ts"
import { resolvePreferredVendor } from "@sma1lboy/rove/src/state/vendor-prefs.ts"
import { DEFAULT_BASE_REF, getCurrentBranch, validateRepoPath } from "@sma1lboy/rove/src/tui/lib/git-snapshot.ts"
import type { VendorId } from "@sma1lboy/rove/src/types/vendor.ts"
import type { OpTable } from "./types.ts"

interface EngineChip {
  readonly id: string
  readonly name: string
}

/** What the quick start creates a task on: the cwd's repo, its current branch, the engine to preselect. */
interface QuickStart {
  readonly repo: string
  readonly label: string
  readonly baseRef: string
  readonly engine: string
}

const chip = (id: VendorId): EngineChip => ({ id, name: engineDisplayName(id) })

export const welcomeDeps = {
  cwd: (): string => process.cwd(),
  gitOnPath: (): boolean => Bun.which("git") !== null,
  async engines(): Promise<{ usable: readonly VendorId[]; signedOut: readonly VendorId[] }> {
    return probeableEngineIds()
      .then(detectEngineStatuses)
      .then(summarizeEngines)
      .catch(() => ({ usable: [], signedOut: [] }))
  },
  /** The TUI's `firstTaskRepo`: the main checkout of the cwd's repo, or null when the cwd is no repo. */
  repoOf(dir: string): string | null {
    try {
      return validateRepoPath(dir) === null ? resolveMainRepoRoot(dir) : null
    } catch {
      return null
    }
  },
  branchOf: (dir: string): string | null => getCurrentBranch(dir),
  preferredEngine: (repo: string): VendorId => resolvePreferredVendor(repo),
}

export const welcomeOps: OpTable = {
  "welcome.env": {
    kind: "read",
    destructive: false,
    wraps: "helpers probeableEngineIds + detectEngineStatuses, firstTaskRepo",
    async run() {
      const [{ usable, signedOut }, git] = await Promise.all([welcomeDeps.engines(), welcomeDeps.gitOnPath()])
      const dir = welcomeDeps.cwd()
      const repo = welcomeDeps.repoOf(dir)
      let start: QuickStart | null = null
      if (repo !== null && git && usable.length > 0) {
        const pref = welcomeDeps.preferredEngine(repo)
        start = {
          repo,
          label: basename(repo),
          baseRef: welcomeDeps.branchOf(dir) ?? welcomeDeps.branchOf(repo) ?? DEFAULT_BASE_REF,
          engine: usable.includes(pref) ? pref : (usable[0] ?? pref),
        }
      }
      return { engines: usable.map(chip), signedOut: signedOut.map(chip), git, start }
    },
  },
}

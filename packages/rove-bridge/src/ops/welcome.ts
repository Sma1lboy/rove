/**
 * The first-run welcome's one read: what the TUI's `welcome-pane.tsx` probes when no task exists
 * (engines installed and signed in, git on PATH) plus the repo its quick start would use, which
 * the TUI takes from its own working directory. Here that is the directory `rove --web` was
 * started in.
 */

import { basename } from "node:path"
import { detectEngineStatuses, probeableEngineIds, summarizeEngines } from "@sma1lboy/rove/src/engine/engine-status.ts"
import { engineDisplayName } from "@sma1lboy/rove/src/engine/interactive-command.ts"
import { getSavedRepos, resolveMainRepoRoot } from "@sma1lboy/rove/src/state/repos.ts"
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

const shellWord = (text: string): string => (/^[\w./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`)

const chip = (id: VendorId): EngineChip => ({ id, name: engineDisplayName(id) })

export const welcomeDeps = {
  /** Null once the directory `rove --web` started in is deleted. */
  cwd: (): string | null => {
    try {
      return process.cwd()
    } catch {
      return null
    }
  },
  gitOnPath: (): boolean => Bun.which("git") !== null,
  /** `programs`: where each found engine's CLI is, since a shell's PATH may not reach it. */
  async engines(): Promise<{
    usable: readonly VendorId[]
    signedOut: readonly VendorId[]
    programs?: Readonly<Record<string, string>>
  }> {
    return probeableEngineIds()
      .then(detectEngineStatuses)
      .then((statuses) => ({
        ...summarizeEngines(statuses),
        programs: Object.fromEntries(statuses.flatMap((s) => (s.binary.path ? [[s.vendor, s.binary.path]] : []))),
      }))
      .catch(() => ({ usable: [], signedOut: [] }))
  },
  savedRepos: (): readonly string[] => [...getSavedRepos()].sort(),
  /** The TUI's `firstTaskRepo`: the main checkout of the cwd's repo, or null when the cwd is no repo. */
  repoOf(dir: string): string | null {
    try {
      return validateRepoPath(dir) === null ? resolveMainRepoRoot(dir) : null
    } catch {
      return null
    }
  },
  branchOf: (dir: string): string | null => getCurrentBranch(dir),
  preferredEngine: (): VendorId => resolvePreferredVendor(),
}

export const welcomeOps: OpTable = {
  "welcome.env": {
    kind: "read",
    destructive: false,
    wraps: "helpers probeableEngineIds + detectEngineStatuses, firstTaskRepo",
    async run() {
      const [{ usable, signedOut, programs }, git] = await Promise.all([welcomeDeps.engines(), welcomeDeps.gitOnPath()])
      const dir = welcomeDeps.cwd()
      const repo = dir === null ? null : welcomeDeps.repoOf(dir)
      let start: QuickStart | null = null
      if (repo !== null && git && usable.length > 0) {
        const pref = welcomeDeps.preferredEngine()
        start = {
          repo,
          label: basename(repo),
          baseRef: welcomeDeps.branchOf(dir ?? repo) ?? welcomeDeps.branchOf(repo) ?? DEFAULT_BASE_REF,
          engine: usable.includes(pref) ? pref : (usable[0] ?? pref),
        }
      }
      return {
        engines: usable.map(chip),
        // `signIn` is the line a shell runs to reach that engine's own login.
        signedOut: signedOut.map((id) => ({ ...chip(id), signIn: shellWord(programs?.[id] ?? id) })),
        git,
        start,
        // A project is picked once the cwd is one or any is saved.
        project: repo ?? welcomeDeps.savedRepos()[0] ?? null,
      }
    },
  },
}

/**
 * Area ops behind the Update page and What's New (TUI `update-page.tsx`, `whats-new-dialog.tsx`):
 * the registry check and GitHub release notes the Mac's Rove build would show. Read-only.
 *
 * Deliberately absent: running the updater. It replaces the Mac's own Rove install, and a
 * remote client triggering that is an owner decision, not a page feature.
 */

import {
  CURRENT_VERSION,
  type ReleaseNotesRangeItem,
  type UpdateInfo,
  checkLatestVersion,
  fetchReleaseNotes,
  fetchReleaseNotesRange,
} from "@sma1lboy/rove/src/version.ts"
import { BridgeError, optBool } from "../protocol.ts"
import { text } from "./args.ts"
import type { OpTable } from "./types.ts"

const VERSION = /^\d+\.\d+\.\d+$/

export interface UpdateDeps {
  readonly current: string
  readonly check: (force: boolean) => Promise<UpdateInfo | null>
  readonly notesRange: (current: string, latest: string) => Promise<readonly ReleaseNotesRangeItem[]>
  readonly notes: (version: string) => Promise<ReleaseNotesRangeItem | null>
}

const realDeps: UpdateDeps = {
  current: CURRENT_VERSION,
  check: (force) => checkLatestVersion({ force }),
  notesRange: (current, latest) => fetchReleaseNotesRange({ current, latest }),
  notes: fetchReleaseNotes,
}

export function createUpdateOps(deps: UpdateDeps = realDeps): OpTable {
  return {
    "update.check": {
      kind: "read",
      destructive: false,
      wraps: "checkLatestVersion + fetchReleaseNotesRange (npm registry, GitHub releases)",
      async run(args) {
        const info = await deps.check(optBool(args, "force") === true)
        // `info: null` = could not look (offline, dev build), never "up to date".
        const notes = info?.hasUpdate ? await deps.notesRange(info.current, info.latest) : []
        return { current: deps.current, info, notes }
      },
    },
    "release.notes": {
      kind: "read",
      destructive: false,
      wraps: "fetchReleaseNotes (GitHub release body for vX.Y.Z)",
      async run(args) {
        const version = text(args, "version", 32)
        if (!VERSION.test(version)) throw new BridgeError("BAD_ARGS", "version must be x.y.z")
        return { notes: await deps.notes(version) }
      },
    },
  }
}

export const updateOps: OpTable = createUpdateOps()

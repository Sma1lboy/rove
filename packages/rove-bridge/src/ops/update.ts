/**
 * Area ops behind the Update page and What's New (TUI `update-page.tsx`, `whats-new-dialog.tsx`):
 * the registry check and GitHub release notes the Mac's Rove build would show. Read-only.
 *
 * Deliberately absent: running the updater. It replaces the Mac's own Rove install, and a
 * remote client triggering that is an owner decision, not a page feature.
 */

import {
  CURRENT_VERSION,
  type NotesLocale,
  type ReleaseNotesRangeItem,
  type UpdateInfo,
  checkLatestVersion,
  fetchReleaseNotes,
  fetchReleaseNotesRange,
} from "@sma1lboy/rove/src/version.ts"
import { BridgeError, optBool } from "../protocol.ts"
import { optOneOf, text } from "./args.ts"
import type { OpTable } from "./types.ts"

const VERSION = /^\d+\.\d+\.\d+$/
const LOCALES = ["en", "zh"] as const

export interface UpdateDeps {
  readonly current: string
  readonly check: (force: boolean) => Promise<UpdateInfo | null>
  readonly notesRange: (
    current: string,
    latest: string,
    locale: NotesLocale,
  ) => Promise<readonly ReleaseNotesRangeItem[]>
  readonly notes: (version: string, locale: NotesLocale) => Promise<ReleaseNotesRangeItem | null>
}

const realDeps: UpdateDeps = {
  current: CURRENT_VERSION,
  check: (force) => checkLatestVersion({ force }),
  notesRange: (current, latest, locale) => fetchReleaseNotesRange({ current, latest, locale }),
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
        const locale = optOneOf(args, "locale", LOCALES) ?? "en"
        // `info: null` = could not look (offline, dev build), never "up to date".
        const notes = info?.hasUpdate ? await deps.notesRange(info.current, info.latest, locale) : []
        return { current: deps.current, info, notes }
      },
    },
    "release.notes": {
      kind: "read",
      destructive: false,
      wraps: "fetchReleaseNotes (GitHub release notes for vX.Y.Z, in `locale` when translated)",
      async run(args) {
        const version = text(args, "version", 32)
        if (!VERSION.test(version)) throw new BridgeError("BAD_ARGS", "version must be x.y.z")
        return { notes: await deps.notes(version, optOneOf(args, "locale", LOCALES) ?? "en") }
      },
    },
  }
}

export const updateOps: OpTable = createUpdateOps()

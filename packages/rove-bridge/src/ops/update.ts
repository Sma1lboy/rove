/**
 * Area ops behind the Update page and What's New (TUI `update-page.tsx`, `whats-new-dialog.tsx`):
 * the registry check and GitHub release notes the Mac's Rove build would show, and Update now:
 * `update.run` starts the same installer `rove update` runs (the stored channel, never a command
 * from the client), one at a time; `update.status` reports it while the page polls.
 */

import { spawn } from "node:child_process"
import { updaterShell, updaterShellFailureHint } from "@sma1lboy/rove/src/lib/updater-shell.ts"

import { DEFAULT_RELEASE_CHANNEL, type ReleaseChannel } from "@sma1lboy/rove/src/release-channels.ts"
import { loadStateFile } from "@sma1lboy/rove/src/state/store.ts"
import { normalizeReleaseChannel, preferredReleaseChannel } from "@sma1lboy/rove/src/state/update-channel.ts"
import {
  CURRENT_VERSION,
  type NotesLocale,
  type ReleaseNotesRangeItem,
  type UpdateInfo,
  checkLatestVersion,
  fetchReleaseNotes,
  fetchReleaseNotesRange,
  updateCommandFor,
} from "@sma1lboy/rove/src/version.ts"
import { BridgeError, optBool } from "../protocol.ts"
import { optOneOf, text } from "./args.ts"
import type { OpTable } from "./types.ts"

const VERSION = /^\d+\.\d+\.\d+$/
const LOCALES = ["en", "zh"] as const

export interface UpdateDeps {
  readonly current: string
  /** `channel` is the dist-tag to ask; unset = the stored `update.channel` preference. */
  readonly check: (force: boolean, channel: ReleaseChannel | null) => Promise<UpdateInfo | null>
  readonly notesRange: (
    current: string,
    latest: string,
    locale: NotesLocale,
  ) => Promise<readonly ReleaseNotesRangeItem[]>
  readonly notes: (version: string, locale: NotesLocale) => Promise<ReleaseNotesRangeItem | null>
  /** Starts the installer; `onOutput` gets its stdout and stderr, `onExit` its exit code (1 when it could not start). */
  readonly install: (onOutput: (chunk: string) => void, onExit: (code: number) => void) => { readonly display: string }
}

/** The installer's output kept for the page: the tail, where npm reports success or the error. */
const OUTPUT_CAP = 16_000

function installLatest(onOutput: (chunk: string) => void, onExit: (code: number) => void): { display: string } {
  const channel = preferredReleaseChannel(loadStateFile())
  // As `rove update`'s plan: the channel rides `sh -s -- <tag>`; `cli/update.ts` itself pulls in the TUI.
  const command = updateCommandFor(channel === DEFAULT_RELEASE_CHANNEL ? undefined : channel)
  const shell = updaterShell()
  const child = spawn(shell, ["-c", command], { stdio: ["ignore", "pipe", "pipe"] })
  child.stdout.on("data", (b: Buffer) => onOutput(b.toString()))
  child.stderr.on("data", (b: Buffer) => onOutput(b.toString()))
  child.on("error", (err) => {
    onOutput(`failed to run ${shell}: ${err.message}\n${updaterShellFailureHint() ?? ""}`)
    onExit(1)
  })
  child.on("close", (code) => onExit(code ?? 1))
  return { display: command }
}

const realDeps: UpdateDeps = {
  current: CURRENT_VERSION,
  // The preference is read per call, so a channel picked a moment ago applies to this check.
  check: (force, channel) =>
    checkLatestVersion({ force, channel: channel ?? preferredReleaseChannel(loadStateFile()) }),
  notesRange: (current, latest, locale) => fetchReleaseNotesRange({ current, latest, locale }),
  notes: fetchReleaseNotes,
  install: installLatest,
}

interface UpdateRun {
  command: string
  output: string
  /** `null` while the installer runs. */
  code: number | null
}

export function createUpdateOps(deps: UpdateDeps = realDeps): OpTable {
  let run: UpdateRun | null = null
  const status = () =>
    run ? { running: run.code === null, command: run.command, code: run.code, output: run.output } : null
  return {
    "update.check": {
      kind: "read",
      destructive: false,
      wraps: "checkLatestVersion + fetchReleaseNotesRange (npm registry, GitHub releases)",
      async run(args) {
        const info = await deps.check(optBool(args, "force") === true, normalizeReleaseChannel(args.channel))
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
    "update.run": {
      kind: "write",
      destructive: true,
      wraps:
        "rove update (the stored channel's installer; the daemon and this bridge keep the old build until restarted)",
      async run() {
        if (run?.code === null) throw new BridgeError("BUSY", "an update is already running")
        const started: UpdateRun = { command: "", output: "", code: null }
        run = started
        started.command = deps.install(
          (chunk) => {
            started.output = (started.output + chunk).slice(-OUTPUT_CAP)
          },
          // `error` and `close` can both fire; the first code stands.
          (code) => {
            if (started.code === null) started.code = code
          },
        ).display
        return { status: status() }
      },
    },
    "update.status": {
      kind: "read",
      destructive: false,
      wraps: "the last update.run of this bridge: running, exit code, output tail",
      async run() {
        return { status: status() }
      },
    },
  }
}

export const updateOps: OpTable = createUpdateOps()

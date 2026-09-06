/** Reset daemon and Hosted PTY state without touching git worktrees. */

import { readFileSync } from "node:fs"
import { unlink } from "node:fs/promises"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { errorMessage } from "@/lib/error-message"
import { stopDaemonProcess } from "@sma1lboy/kobe-daemon/daemon/lifecycle"
import {
  defaultDaemonPidPath,
  defaultDaemonSocketPath,
  defaultPtyFreezeDir,
  defaultPtyHostPidPath,
  defaultPtyHostSocketPath,
} from "@sma1lboy/kobe-daemon/daemon/paths"
import { clearFrozenSessions } from "@sma1lboy/kobe-daemon/daemon/pty-freeze-store"
import { kvStatePath, legacyKobeKvStatePath, legacyKobeStateDir, roveStateDir } from "../env.ts"
import { stopLegacyTmux } from "./legacy-tmux.ts"
import { activeCliName } from "./rename-compat.ts"
import { stampResetGate } from "./reset-gate.ts"

const CLI_NAME = activeCliName()

function printUsage(out: Pick<typeof process.stderr, "write">): void {
  out.write(
    [
      `Usage: ${CLI_NAME} reset [--hard] [--yes]`,
      "",
      "Recover a wedged install: stop the daemon, Hosted PTY host, and any pre-v0.8 tmux sessions.",
      "This ends background terminal and engine sessions; the next launch starts fresh.",
      "Never touches your git worktrees.",
      "",
      "Options:",
      "  --hard        Also DELETE the task index and the whole settings file",
      "                (saved projects, custom engines, theme, language, onboarding)",
      "  -y, --yes     Skip the interactive confirmation. REQUIRED without a terminal;",
      "                a non-interactive run without it exits 2 and changes nothing.",
      "  -h, --help    Print this help",
      "",
    ].join("\n"),
  )
}

function taskCount(path: string): number | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { tasks?: unknown[] }
    return Array.isArray(parsed.tasks) ? parsed.tasks.length : null
  } catch {
    return null
  }
}

/**
 * What `--hard` actually destroys in the settings file.
 *
 * `removeStateFile` unlinks the WHOLE of `~/.config/rove/state.json`, not
 * some "UI state" subset: saved projects, every registered custom engine
 * (`customEngineIds` plus its `engineCommand.*` / `engineName.*` bodies — the
 * only record they exist), theme, default engine, language and the onboarding
 * flag all go with it. The backfill in `core/index.ts` cannot restore the
 * projects either, because `--hard` deletes tasks.json in the same breath.
 * So the preview names them, with counts, instead of saying "UI state".
 */
function stateSummary(path: string): string[] {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  } catch {
    return []
  }
  const count = (key: string) => (Array.isArray(parsed[key]) ? (parsed[key] as unknown[]).length : 0)
  const lines = [
    `      saved projects: ${count("savedRepos")}`,
    `      custom engines: ${count("customEngineIds")} (their launch commands live here and nowhere else)`,
  ]
  const named: [string, string][] = [
    ["activeTheme", "theme"],
    ["defaultVendor", "default engine"],
    ["locale", "language"],
    ["onboarded", "onboarding (the wizard runs again)"],
  ]
  const present = named.filter(([key]) => parsed[key] !== undefined).map(([, label]) => label)
  if (present.length > 0) lines.push(`      also set: ${present.join(", ")}`)
  lines.push(`      ${Object.keys(parsed).length} setting(s) in total`)
  return lines
}

async function confirmTty(prompt: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise<string>((resolve) => readline.question(prompt, resolve))
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    readline.close()
  }
}

async function removeStateFile(path: string, label: string): Promise<void> {
  try {
    await unlink(path)
    console.log(`  removed ${label} (${path})`)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") console.log(`  ${label}: already absent`)
    else throw new Error(`failed to remove ${label} (${path}): ${errorMessage(err)}`)
  }
}

export async function runResetSubcommand(argv: readonly string[]): Promise<void> {
  if (argv.some((arg) => arg === "--help" || arg === "-h" || arg === "help")) {
    printUsage(process.stdout)
    return
  }
  const known = new Set(["--hard", "--yes", "-y"])
  const unknown = argv.find((arg) => !known.has(arg))
  if (unknown !== undefined) {
    process.stderr.write(`${CLI_NAME} reset: unknown argument "${unknown}"\n\n`)
    printUsage(process.stderr)
    process.exit(2)
  }

  const hard = argv.includes("--hard")
  const yes = argv.includes("--yes") || argv.includes("-y")
  const daemonSocket = defaultDaemonSocketPath()
  const tasksPath = join(roveStateDir(), "tasks.json")
  const legacyTasksPath = join(legacyKobeStateDir(), "tasks.json")
  const statePath = kvStatePath()
  const legacyStatePath = legacyKobeKvStatePath()

  console.log(`${CLI_NAME} reset will:`)
  console.log("  • stop the Rove daemon (graceful → SIGTERM → SIGKILL)")
  console.log(`  • remove its socket + pidfile (${daemonSocket})`)
  console.log("  • stop the standalone Hosted PTY host and all background terminal/engine sessions")
  console.log("  • stop any pre-v0.8 tmux sessions after SIGTERM-ing their pane process groups")
  if (hard) {
    const count = taskCount(tasksPath) ?? taskCount(legacyTasksPath)
    console.log(`  • DELETE the task index${count === null ? "" : ` (${count} task(s))`} — ${tasksPath}`)
    console.log(`  • DELETE the whole settings file — ${statePath}`)
    for (const line of stateSummary(statePath)) console.log(line)
    console.log("  • DELETE the pre-Rove task/UI indexes too, so migration cannot restore reset state")
  }
  console.log("  • NOT touch your git worktrees under ~/.rove/worktrees/, ~/.kobe/worktrees/, or repo-local roots")
  if (!hard)
    console.log(
      "  (your task list, settings & worktrees are kept — add --hard to also delete the task index and settings file)",
    )

  if (!yes) {
    if (!process.stdin.isTTY) {
      // Exit 2, not 0. The plan above has already been printed in full, and a
      // caller that reads only the status code would otherwise take "I did
      // nothing" for "I reset your install" — the same silent-success shape as
      // #918. `daemon stop` may exit 0 on a no-op because the goal state is
      // reached; nothing about this run reached it.
      console.log("\nre-run with --yes to proceed (no interactive terminal for a y/N prompt) — nothing was changed")
      process.exitCode = 2
      return
    }
    const confirmed = await confirmTty(
      hard ? "\nStop runtimes and DELETE the task index + settings file? [y/N] " : "\nStop runtimes? [y/N] ",
    )
    if (!confirmed) {
      console.log("aborted — nothing changed")
      return
    }
  }

  console.log("")
  const daemon = await stopDaemonProcess(daemonSocket, defaultDaemonPidPath())
  console.log(
    daemon.method === "absent"
      ? "  daemon: was not running (cleared any stale socket/pidfile)"
      : `  daemon: stopped via ${daemon.method}${daemon.pid ? ` (pid ${daemon.pid})` : ""}`,
  )

  const ptyHost = await stopDaemonProcess(defaultPtyHostSocketPath(), defaultPtyHostPidPath())
  console.log(
    ptyHost.method === "absent"
      ? "  pty host: was not running (cleared any stale socket/pidfile)"
      : `  pty host: stopped via ${ptyHost.method}${ptyHost.pid ? ` (pid ${ptyHost.pid})` : ""}`,
  )

  // "All frozen rings are dropped" (docs/SESSIONS.md) is the host's own doing
  // — but ONLY on the `daemon.stop` RPC path, which sets `wipeFreezeOnStop`.
  // A host wedged badly enough to need SIGTERM/SIGKILL — exactly the state
  // TROUBLESHOOTING points at reset for — never runs that code, and a host
  // that was already dead never had the chance, so every frozen archive
  // survives and the next boot restores the whole scene reset was asked to
  // end. Finish the job here when the graceful path did not.
  if (ptyHost.method !== "graceful") {
    clearFrozenSessions(defaultPtyFreezeDir())
    console.log(`  frozen sessions: cleared (${ptyHost.method} stop skips the host's own wipe)`)
  }

  const legacyTmux = await stopLegacyTmux()
  if (legacyTmux.status === "failed") {
    console.error(`  legacy tmux: cleanup failed — ${legacyTmux.error ?? "unknown error"}`)
    process.exitCode = 1
    return
  }
  console.log(
    legacyTmux.status === "absent"
      ? "  legacy tmux: no pre-v0.8 sessions found"
      : `  legacy tmux: stopped ${legacyTmux.sessions} session(s) after signalling ${legacyTmux.signalledGroups} pane group(s)`,
  )

  if (hard) {
    await removeStateFile(tasksPath, "task index")
    await removeStateFile(legacyTasksPath, "legacy task index")
    await removeStateFile(statePath, "UI state")
    await removeStateFile(legacyStatePath, "legacy UI state")
  } else stampResetGate()

  console.log(`\n${CLI_NAME}: reset complete. Relaunch Rove to start fresh.`)
}

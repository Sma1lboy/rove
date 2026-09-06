/**
 * `kobe update` — self-update helper for the globally-installed CLI.
 *
 * The TUI update chip points at a GitHub-hosted update script. This
 * wrapper intentionally delegates to that remote script instead of
 * baking the package-manager command into the binary, so future install
 * flow changes only require editing `scripts/update.sh` on main.
 *
 * `kobe update <version>` pins the install (the script receives the
 * version as `sh -s -- <version>`); `kobe update list` prints recent
 * published versions. Verbs are the canonical spelling — `--list` /
 * `--dry-run` stay as accepted aliases. Installing across a
 * {@link BREAKING_VERSIONS} entry prints a
 * heads-up that the next launch will demand `kobe reset` (the boot gate
 * in reset-gate.ts is the enforcement point — the script stays dumb).
 */

import { spawnSync } from "node:child_process"
import {
  BREAKING_VERSIONS,
  CURRENT_VERSION,
  DEFAULT_RELEASE_CHANNEL,
  RELEASE_CHANNELS,
  type ReleaseChannel,
  UPDATE_COMMAND,
  UPDATE_SCRIPT_URL,
  breakingVersionsCrossed,
  channelOf,
  checkLatestVersion,
  fetchReleaseSummaries,
  recommendedGlobalInstallCommand,
} from "../version.ts"
import { activeCliName } from "./rename-compat.ts"

const CLI_NAME = activeCliName()

export type UpdatePlan = {
  command: string
  args: string[]
  display: string
}

type RunDeps = {
  spawn: typeof spawnSync
  stdout: Pick<typeof process.stdout, "write">
  stderr: Pick<typeof process.stderr, "write">
  exit: (code: number) => never
}

/**
 * The install target passed through to `update.sh`: an exact version, or a
 * channel name the script resolves as an npm dist-tag. Both take the same
 * `sh -s -- <arg>` slot, so `nightly` needs no separate flag downstream.
 */
export function updatePlan(target?: string): UpdatePlan {
  const shell = target === undefined ? UPDATE_COMMAND : `${UPDATE_COMMAND} -s -- ${target}`
  return {
    command: "sh",
    args: ["-c", shell],
    display: shell,
  }
}

type ParsedArgs = {
  help: boolean
  dryRun: boolean
  list: boolean
  /** Pinned target version (`kobe update 0.7.90`); undefined = channel head. */
  version?: string
  /**
   * Explicit `--channel <name>`. Undefined means "stay on whichever channel
   * this build came from" — switching is an explicit act, never a default.
   */
  channel?: ReleaseChannel
}

const VERSION_SHAPE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

function isReleaseChannel(value: string): value is ReleaseChannel {
  return (RELEASE_CHANNELS as readonly string[]).includes(value)
}

export function parseUpdateArgs(args: readonly string[]): ParsedArgs {
  let dryRun = false
  let list = false
  let version: string | undefined
  let channel: ReleaseChannel | undefined

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === undefined) continue
    if (arg === "--help" || arg === "-h" || arg === "help") return { help: true, dryRun, list, version, channel }
    if (arg === "dry-run" || arg === "--dry-run") {
      dryRun = true
      continue
    }
    if (arg === "list" || arg === "--list") {
      list = true
      continue
    }
    // `--channel nightly` and `--channel=nightly` both land here. An
    // unknown name is refused rather than passed through: npm resolves an
    // unpublished dist-tag to a 404 the install script reports as a
    // generic failure, which reads like a broken network.
    if (arg === "--channel" || arg.startsWith("--channel=")) {
      const inline = arg.startsWith("--channel=") ? arg.slice("--channel=".length) : undefined
      const value = inline ?? args[++i]
      if (value === undefined || !isReleaseChannel(value)) {
        process.stderr.write(
          `${CLI_NAME} update: --channel expects one of ${RELEASE_CHANNELS.join(", ")}${
            value === undefined ? "" : ` (got "${value}")`
          }\n\n`,
        )
        printUsage(process.stderr)
        process.exit(2)
      }
      channel = value
      continue
    }
    // A bare channel name is the shorthand: `rove update nightly`.
    if (channel === undefined && isReleaseChannel(arg)) {
      channel = arg
      continue
    }
    if (version === undefined && VERSION_SHAPE.test(arg)) {
      version = arg
      continue
    }
    // Malformed invocation → show the error AND the usage, exit 2. An
    // agent that guesses a flag wrong should land on the instruction
    // surface, not a bare one-liner.
    process.stderr.write(`${CLI_NAME} update: unknown argument "${arg}"\n\n`)
    printUsage(process.stderr)
    process.exit(2)
  }

  return { help: false, dryRun, list, version, channel }
}

function printUsage(out: Pick<typeof process.stderr, "write">): void {
  out.write(
    [
      `Usage: ${CLI_NAME} update [version|channel|list|dry-run]`,
      "",
      "Runs Rove's GitHub-hosted update script. With [version] (e.g.",
      "0.7.90) the script installs that exact release instead of the",
      "head of your channel.",
      "",
      "Verbs (--flag spellings also accepted):",
      "  list      Browse recent versions — a TUI page with release notes",
      "            when interactive, plain text when piped",
      "  dry-run   Print the command without running it",
      "",
      "Flags:",
      "  --channel <name>   Install from this channel instead of yours. The",
      "                     bare name works too: `update nightly`",
      "",
      "Channels:",
      "  latest    Stable releases (default)",
      "  nightly   Automated nightly cut from main — newer, less baked",
      "",
      `You are on: ${channelOf()}`,
      "",
      "Switching channels is just installing from the other one; there is",
      "no stored setting. Update checks follow the build you are running.",
      "",
      "Default command:",
      `  ${UPDATE_COMMAND}`,
      "",
      "Script URL:",
      `  ${UPDATE_SCRIPT_URL}`,
      "",
      "Manual fallback:",
      `  ${recommendedGlobalInstallCommand()}`,
      "",
      "Examples:",
      `  ${CLI_NAME} update`,
      `  ${CLI_NAME} update 0.7.90`,
      `  ${CLI_NAME} update nightly`,
      `  ${CLI_NAME} update --channel latest`,
      `  ${CLI_NAME} update list`,
      `  ${CLI_NAME} update dry-run`,
      "",
    ].join("\n"),
  )
}

/** `--list`: recent GitHub releases, newest first, current marked. */
async function printVersionList(io: RunDeps): Promise<void> {
  const releases = await fetchReleaseSummaries(20)
  if (releases.length === 0) {
    io.stderr.write(`${CLI_NAME} update: could not fetch the release list (offline or rate-limited)\n`)
    io.exit(1)
  }
  for (const release of releases) {
    const markers = [
      release.version === CURRENT_VERSION ? "(current)" : "",
      BREAKING_VERSIONS.includes(release.version) ? `(breaking — needs \`${CLI_NAME} reset\`)` : "",
    ]
      .filter(Boolean)
      .join(" ")
    io.stdout.write(`${release.version}${markers ? `  ${markers}` : ""}\n`)
  }
  io.stdout.write(`\ninstall one with: ${CLI_NAME} update <version>\n`)
}

/**
 * Best-effort heads-up when the move crosses a breaking version. Pinned
 * targets need no network; a channel head resolves via the registry and
 * stays silent when offline — the boot gate is the real enforcement point.
 */
async function warnBreakingCrossings(target: string | undefined, channel: ReleaseChannel, io: RunDeps): Promise<void> {
  // Nothing registered → nothing to warn about; skip the channel-head
  // lookup entirely so the common path (and the tests) never touch the net.
  if (BREAKING_VERSIONS.length === 0) return
  const resolved = target ?? (await checkLatestVersion({ force: true, channel }))?.latest
  if (!resolved) return
  const crossed = breakingVersionsCrossed(CURRENT_VERSION, resolved)
  if (crossed.length === 0) return
  io.stderr.write(
    [
      `warning: ${CURRENT_VERSION} -> ${resolved} crosses breaking version(s): ${crossed.join(", ")}.`,
      `After this update, Rove will refuse to start until you run \`${CLI_NAME} reset\``,
      "(worktrees are never touched; add --hard only to also wipe the task index).",
      "",
    ].join("\n"),
  )
}

/**
 * What a finished install has NOT done yet.
 *
 * Installing new files does not replace running processes, and Rove keeps two
 * of them: the daemon (restartable, and doctor already flags it) and the PTY
 * host, which by design survives every `daemon restart` and can only be
 * replaced by `rove reset` — at the cost of every live session. An update that
 * printed nothing here left both serving the old build with the CLI reporting
 * success; the only mention of it lived in TROUBLESHOOTING, and covered only
 * the daemon.
 */
const FOLLOW_UP_NOTE = [
  "",
  `${CLI_NAME}: installed. Two background processes are still running the old build:`,
  `  daemon    → \`${CLI_NAME} daemon restart\` (safe; never touches live sessions)`,
  `  pty host  → only \`${CLI_NAME} reset\` replaces it, and that ends every live`,
  "              terminal and engine session — do it when you can afford to.",
  `Run \`${CLI_NAME} doctor\` to see which of the two is actually stale.`,
  "",
].join("\n")

export async function runUpdateSubcommand(args: readonly string[], deps?: Partial<RunDeps>): Promise<void> {
  const io: RunDeps = {
    spawn: deps?.spawn ?? spawnSync,
    stdout: deps?.stdout ?? process.stdout,
    stderr: deps?.stderr ?? process.stderr,
    exit: deps?.exit ?? ((code) => process.exit(code)),
  }
  const parsed = parseUpdateArgs(args)
  if (parsed.help) {
    printUsage(io.stdout)
    return
  }
  if (parsed.list) {
    // Interactive terminal → the TUI versions browser (list + release
    // notes + pinned install). Injected deps (tests) or a pipe keep the
    // plain parseable text output for scripts and agents.
    if (deps === undefined && process.stdout.isTTY) {
      const { startVersionsHost } = await import("../tui-react/component/versions-page.tsx")
      await startVersionsHost()
      return
    }
    await printVersionList(io)
    return
  }

  // An explicit --channel wins; otherwise stay on the channel this build
  // came from. A pinned version outranks both — it names one exact build,
  // and the channel it belongs to is whatever that version says it is.
  const channel = parsed.channel ?? channelOf()
  const target = parsed.version ?? (channel === DEFAULT_RELEASE_CHANNEL ? undefined : channel)
  const plan = updatePlan(target)
  const switching = parsed.channel !== undefined && parsed.channel !== channelOf()
  io.stdout.write(`${CLI_NAME} ${CURRENT_VERSION} -> ${target ?? channel}\n`)
  if (switching) io.stdout.write(`switching channel: ${channelOf()} -> ${channel}\n`)
  io.stdout.write(`running: ${plan.display}\n`)
  // Warn BEFORE the dry-run bail. A dry run is the rehearsal — "print what you
  // would do" that omits the one thing you would have had to act on is the
  // wrong half to leave out.
  await warnBreakingCrossings(parsed.version, channel, io)
  if (parsed.dryRun) return

  const result = io.spawn(plan.command, plan.args, { stdio: "inherit" })
  if (result.error) {
    io.stderr.write(`${CLI_NAME} update: failed to run ${plan.command}: ${result.error.message}\n`)
    io.exit(1)
  }
  if (result.status === 0) io.stdout.write(FOLLOW_UP_NOTE)
  io.exit(result.status ?? 1)
}

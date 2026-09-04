/**
 * Exclusive claim on a HOME, independent of the socket path.
 *
 * The daemon singleton is keyed on its socket: `defaultDaemonSocketPath`
 * returns the `ROVE_DAEMON_SOCKET_PATH` override before it ever looks at the
 * home (`paths.ts`), and `socket-guard.ts` watches only its OWN path. So two
 * daemons pointed at one home through two different socket overrides cannot
 * see each other at all — which is an ordinary accident, because this repo's
 * own harness/capture isolation recipes override the socket while leaving
 * `ROVE_HOME_DIR` alone.
 *
 * What that costs is not one racy file. Both daemons run the full state root:
 * `tasks.json` (their task lists diverge permanently and `ensureMainTask`
 * writes the project-main row twice), `automations.json`, and
 * `.config/rove/state.json` — observed in the field with one daemon's repo
 * path landing inside the `state.json` the other wrote. That is why the claim
 * is on the HOME rather than an extra lock around the task index: the index
 * is one of several things a second daemon would corrupt.
 *
 * The claim is a file, `<home>/.rove/daemon.owner`, holding `pid:socketPath`.
 * Verification does NOT trust the pid — pids get reused, and a crashed daemon
 * leaves its claim behind. It asks the recorded SOCKET whether a daemon is
 * still answering there, which is the same question `startDaemonServer`
 * already asks of its own path. A stale claim therefore needs no sweeping:
 * its socket is absent, so it is simply overwritten.
 */

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { probeDaemonSocket } from "../client/daemon-process.ts"
import { ROVE_STATE_DIR_BASENAME } from "../compat-env.ts"

/** Probe used to decide whether a recorded claim is still live. */
export type SocketLivenessProbe = (socketPath: string) => Promise<boolean>

const defaultProbe: SocketLivenessProbe = async (socketPath) => (await probeDaemonSocket(socketPath)) === "alive"

export interface HomeOwnerClaim {
  readonly pid: number
  readonly socketPath: string
}

export function daemonHomeOwnerPath(homeDir: string): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "daemon.owner")
}

/** Parse `<pid>:<socketPath>`. Split on the FIRST colon only — the rest is a
 *  filesystem path and may contain more. Returns null for anything unreadable
 *  or malformed: an unusable claim must never block a boot. */
export function parseHomeOwnerClaim(raw: string): HomeOwnerClaim | null {
  const text = raw.trim()
  const at = text.indexOf(":")
  if (at <= 0) return null
  const pid = Number.parseInt(text.slice(0, at), 10)
  const socketPath = text.slice(at + 1)
  if (!Number.isFinite(pid) || pid <= 0 || socketPath.length === 0) return null
  return { pid, socketPath }
}

export async function readHomeOwnerClaim(homeDir: string): Promise<HomeOwnerClaim | null> {
  try {
    return parseHomeOwnerClaim(await readFile(daemonHomeOwnerPath(homeDir), "utf8"))
  } catch {
    return null
  }
}

/**
 * Refuse to boot a second daemon on a home a live one already owns.
 *
 * Only a claim naming a DIFFERENT socket can refuse: our own socket path was
 * already probed by `startDaemonServer` (a live owner there throws first), so
 * a claim naming it is our own crashed predecessor.
 */
export async function assertHomeUnclaimed(options: {
  readonly homeDir: string
  readonly socketPath: string
  readonly probe?: SocketLivenessProbe
}): Promise<void> {
  const claim = await readHomeOwnerClaim(options.homeDir)
  if (!claim || claim.socketPath === options.socketPath) return
  if (!(await (options.probe ?? defaultProbe)(claim.socketPath))) return
  const remedy = "Stop that daemon, or point ROVE_HOME_DIR at a different home."
  throw new Error(
    `rove daemon: ${options.homeDir} is already served by the daemon on ${claim.socketPath} (pid ${claim.pid}) — refusing to start a second daemon on one home. ${remedy}`,
  )
}

/** Record this process as the home's owner. Call after bind, next to the
 *  pidfile write, so a refused boot never overwrites the incumbent's claim. */
export async function claimHome(homeDir: string, socketPath: string): Promise<void> {
  const path = daemonHomeOwnerPath(homeDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${process.pid}:${socketPath}\n`, "utf8")
}

/** Drop the claim on shutdown, and ONLY while it still names us — same
 *  fail-closed rule as `socket-guard.ts#release`: a superseded daemon exiting
 *  late must not delete the new owner's claim. */
export async function releaseHomeClaim(homeDir: string, socketPath: string): Promise<void> {
  const claim = await readHomeOwnerClaim(homeDir)
  if (!claim || claim.pid !== process.pid || claim.socketPath !== socketPath) return
  await unlink(daemonHomeOwnerPath(homeDir)).catch(() => {})
}

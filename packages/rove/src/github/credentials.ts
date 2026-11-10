/**
 * Moving a GitHub sign-in around: Rove's account is the hub's own `gh` login. A token is read from
 * `gh` in this process, written to the target's `gh` over stdin, and never stored, logged or put
 * in argv. Each machine's credentials stay in that machine's `gh` store.
 */

import type { ApiEnvelope } from "@sma1lboy/rove-daemon/daemon/protocol"
import { ApiError } from "../cli/api/types.ts"
import { forwardVerb, requireMachine } from "../machines/forward.ts"
import { type MachineEntry, dedupeMachines, listMachines } from "../machines/registry.ts"
import { DeviceLogin, spawnGhLogin } from "./login.ts"
import { GH_ENV, GITHUB_HOST, type RunTool, runTool } from "./run-tool.ts"
import { type GithubStatus, githubStatus } from "./status.ts"

const GH_MS = 15_000
/** gh's token alphabet (classic, fine-grained, OAuth); anything else cannot be one. */
const TOKEN_SHAPE = /^[A-Za-z0-9_]{20,255}$/

/** `gh auth setup-git`: make `git push` over https use gh's credentials. Best effort. */
async function setupGit(run: RunTool): Promise<void> {
  await run("gh", ["auth", "setup-git", "--hostname", GITHUB_HOST], { timeoutMs: GH_MS, env: GH_ENV })
}

/** Machines that are signed out of GitHub get this hub's account once a sign-in here completes. */
async function finishLogin(syncOthers: boolean, run: RunTool = runTool): Promise<void> {
  await setupGit(run)
  if (!syncOthers) return
  const token = await readHubToken(run).catch(() => null)
  if (!token) return
  await autoSyncSignedOut(token)
}

export const deviceLogin = new DeviceLogin({ spawn: spawnGhLogin, finish: (syncOthers) => finishLogin(syncOthers) })

export const localStatus = (run?: RunTool): Promise<GithubStatus> =>
  githubStatus({ ...(run ? { run } : {}), login: () => deviceLogin.state() })

/** This machine's `gh` token. It lives in memory for the length of one sync and nowhere else. */
export async function readHubToken(run: RunTool = runTool): Promise<string> {
  const res = await run("gh", ["auth", "token", "--hostname", GITHUB_HOST], { timeoutMs: GH_MS, env: GH_ENV })
  const token = res.stdout.trim()
  if (res.missing) throw new ApiError("gh is not installed on this machine", "GITHUB_GH_MISSING")
  if (res.code !== 0 || !token) {
    throw new ApiError("this machine is not signed in to GitHub", "GITHUB_SIGNED_OUT", {
      hint: "connect GitHub here first (`rove api github-login`)",
    })
  }
  return token
}

/** Redact the token from anything gh printed back before it can reach an error message. */
const scrub = (text: string, token: string): string => text.split(token).join("***").trim().slice(0, 300)

/** Sign this machine's `gh` in with a token from another machine's hub. */
export async function applyToken(token: string, run: RunTool = runTool): Promise<GithubStatus> {
  if (!TOKEN_SHAPE.test(token)) throw new ApiError("the token is not a GitHub token", "BAD_FLAG")
  const res = await run("gh", ["auth", "login", "--with-token", "--hostname", GITHUB_HOST], {
    timeoutMs: GH_MS,
    env: GH_ENV,
    input: `${token}\n`,
  })
  if (res.missing) throw new ApiError("gh is not installed on this machine", "GITHUB_GH_MISSING")
  if (res.code !== 0) {
    throw new ApiError(
      `gh refused the token: ${scrub(res.stderr || res.stdout, token) || "no output"}`,
      "GITHUB_LOGIN_FAILED",
    )
  }
  // The existing git_protocol is kept: an unset one already reads as https, and a machine set to ssh stays on ssh.
  await setupGit(run)
  return localStatus(run)
}

/** Sign this machine's `gh` out of github.com (the active account). */
export async function logoutGithub(run: RunTool = runTool): Promise<GithubStatus> {
  const before = await localStatus(run)
  if (!before.account) throw new ApiError("this machine is not signed in to GitHub", "GITHUB_SIGNED_OUT")
  const res = await run("gh", ["auth", "logout", "--hostname", GITHUB_HOST, "--user", before.account], {
    timeoutMs: GH_MS,
    env: GH_ENV,
  })
  if (res.code !== 0) {
    throw new ApiError(
      `gh could not sign out: ${(res.stderr || res.stdout).trim().slice(0, 300)}`,
      "GITHUB_LOGOUT_FAILED",
    )
  }
  return localStatus(run)
}

type Forward = typeof forwardVerb

function unwrap(envelope: ApiEnvelope): unknown {
  if (envelope.ok) return envelope.result
  const { message, code, ...data } = envelope.error
  throw new ApiError(message, code, data)
}

/** Send `token` to `alias`'s daemon, which signs its own `gh` in. Returns that machine's new status. */
export async function syncTo(alias: string, token: string, forward: Forward = forwardVerb): Promise<GithubStatus> {
  const envelope = await forward(requireMachine(alias), "github-apply", { token })
  return unwrap(envelope) as GithubStatus
}

/**
 * Every other machine that is online, has `gh` and is signed out. A machine on another account, or one
 * whose login `gh` reports as unusable (`authDetail`: an expired token may still be someone else's), is
 * left for the owner to decide with "Use Rove's account".
 */
export async function autoSyncSignedOut(
  token: string,
  forward: Forward = forwardVerb,
  machines: readonly MachineEntry[] = dedupeMachines(listMachines()),
): Promise<string[]> {
  const synced: string[] = []
  await Promise.allSettled(
    machines.map(async (entry) => {
      const status = unwrap(await forward(entry, "github-status", {})) as GithubStatus
      if (!status.gh || status.account || status.authDetail) return
      unwrap(await forward(entry, "github-apply", { token }))
      synced.push(entry.alias)
    }),
  )
  return synced
}

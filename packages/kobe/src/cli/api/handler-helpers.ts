/**
 * Tiny shared helpers every handler module (and several inline handlers in
 * the {@link VERBS} table) reach for. Split out of `api-cmd.ts` (see that
 * file's header) into its own module — rather than folded into one handler
 * file — because `verbs.ts` needs `simpleRpc` for its inline CRUD verbs
 * without depending on any one handler group.
 */

import type { DaemonRpc } from "../daemon-session.ts"
import { ApiError, type VerbContext } from "./types.ts"

/** The daemon RPC surface, or the canonical "daemon required" error for an offline call. */
export function daemonOf(ctx: VerbContext): DaemonRpc {
  if (!ctx.client) throw new ApiError("daemon required", "BAD_DAEMON")
  return ctx.client
}

/**
 * A `--repo` filter that says what it could not resolve instead of quietly
 * answering "not this repo".
 *
 * `resolveRepoRoot` returns its INPUT unchanged when git cannot answer, so a
 * repo that moved (or became unreadable) compares unequal against every
 * spelling — including its own recorded one, because the stored `task.repo`
 * is the canonicalized form and a freshly typed path no longer gets
 * canonicalized by git. Filtering on that comparison alone rendered "I cannot
 * tell" as `{"tasks": []}`: the same answer a project with nothing running
 * gives, and the answer a coordinator reads as "this round is empty".
 *
 * So there are two honest outcomes, both louder than an empty list:
 *   - the TARGET does not resolve — the caller named a path that is not a
 *     readable repo, which is an error about their own argument; and
 *   - some TASK repos do not resolve — reported in `unresolvableRepos`
 *     beside the answer, the same null-versus-empty shape
 *     `discover-adoptable` keeps for `unreadable`.
 *
 * Each distinct path is resolved once (the old code re-shelled out to git per
 * task).
 */
export async function repoFilter(
  runtime: VerbContext["runtime"],
  repoFlag: string,
  repos: Iterable<string>,
): Promise<{
  readonly target: string
  readonly matches: (repo: string) => boolean
  readonly unresolvableRepos: readonly string[]
}> {
  const target = await runtime.resolveRepoRoot(repoFlag)
  if (!(await runtime.isUsableRepo(target))) {
    throw new ApiError(
      `--repo ${repoFlag} is not a readable git repository (resolved to ${target}) — the project may have moved or been deleted; \`rove api list\` still shows its tasks`,
      "REPO_UNRESOLVABLE",
    )
  }
  const resolved = new Map<string, string>()
  const unresolvable = new Set<string>()
  for (const repo of new Set(repos)) {
    const root = await runtime.resolveRepoRoot(repo)
    resolved.set(repo, root)
    if (root !== target && !(await runtime.isUsableRepo(root))) unresolvable.add(repo)
  }
  return {
    target,
    matches: (repo) => resolved.get(repo) === target,
    unresolvableRepos: [...unresolvable].sort(),
  }
}

/** Fire one daemon RPC and return its raw payload (the generic CRUD shape). */
export async function simpleRpc(ctx: VerbContext, name: string, payload: Record<string, unknown>): Promise<unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: the protocol's request name is a finite union; this is the one generic call site.
  return daemonOf(ctx).request(name as any, payload)
}

/**
 * `pty-list` — inventory of the standalone pty host's sessions (key, pid,
 * command, live OSC window title — the same "实时进程名" stream the TUI tab
 * strip shows). Talks to the PTY HOST socket, not the daemon (offline verb),
 * and never spawns a host.
 *
 * `sessions: null` when there is no host to ask. It used to be `[]`, which is
 * also the answer for a LIVE host running nothing — so an agent reading
 * `{"sessions":[]}` concluded the fleet was idle and could respawn work that
 * was already running, or call a live task dead. `inspect`'s sessions section
 * has always returned `null` for this exact failure; the two verbs now agree.
 * Moved here from `verbs.ts` to keep that file under the size cap.
 */
export async function handlePtyList(): Promise<unknown> {
  const [{ KobeDaemonClient }, { defaultPtyHostSocketPath }] = await Promise.all([
    import("@sma1lboy/kobe-daemon/client"),
    import("@sma1lboy/kobe-daemon/daemon/paths"),
  ])
  const client = new KobeDaemonClient(defaultPtyHostSocketPath())
  try {
    await client.connect()
    return await client.request("pty.list", {})
  } catch {
    return { sessions: null }
  } finally {
    client.close()
  }
}

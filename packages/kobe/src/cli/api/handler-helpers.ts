/**
 * Tiny shared helpers for handler modules and the inline handlers in
 * {@link VERBS} — its own module so `verbs.ts` needn't depend on any one
 * handler group.
 */

import { samePath } from "@sma1lboy/kobe-daemon/path-identity"
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
 * moved/unreadable repo compares unequal to every spelling, even its own
 * stored canonical one — and "cannot tell" would read as `{"tasks": []}`.
 * Instead:
 *   - an unresolvable TARGET is an error about the caller's argument;
 *   - unresolvable TASK repos are listed in `unresolvableRepos` (same
 *     null-versus-empty shape as `discover-adoptable`'s `unreadable`).
 *
 * Each distinct path is resolved once.
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
    if (!samePath(root, target) && !(await runtime.isUsableRepo(root))) unresolvable.add(repo)
  }
  return {
    target,
    matches: (repo) => samePath(resolved.get(repo), target),
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
 * `sessions: null` when there is no host to ask — `[]` means a LIVE host
 * running nothing, and conflating them makes an agent respawn running work.
 * Matches `inspect`'s sessions section.
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

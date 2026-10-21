/**
 * Run a `rove api` verb on another machine: the verb crosses the forwarded
 * daemon socket as `api.invoke`, so it executes inside THAT machine's daemon —
 * its git, its PTY host, its engine logins. This machine only routes.
 *
 * A forwarded call carries `forwarded: true, from: hostname()` and is never routed again, so two
 * machines that registered each other cannot bounce a verb between them.
 */

import { hostname } from "node:os"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import {
  type ApiEnvelope,
  type ApiParams,
  ROVE_API_VERSION,
  type SerializedTask,
} from "@sma1lboy/rove-daemon/daemon/protocol"
import { ApiError } from "../cli/api/types.ts"
import { errorMessage } from "../lib/error-message.ts"
import { getSavedRepos } from "../state/repos.ts"
import { discoverMachine } from "./discover.ts"
import { type MachineEntry, dedupeMachines, listMachines, updateMachine } from "./registry.ts"
import { type RepoIdentity, isLocalCheckout, repoIdentity, unpushedCommits } from "./repo-identity.ts"
import { findCheckouts, parseRepoRef } from "./repo-ref.ts"
import { localDaemonSocketPath, localPtySocketPath } from "./ssh-args.ts"
import { ensureForwards } from "./tunnel.ts"

/** `--machine local` names this machine explicitly. */
export const LOCAL_MACHINE = "local"

/**
 * The local end of a machine's daemon socket, bringing the forward up when
 * nothing listens. It rides the shared ssh connection, so only the first call
 * after a quiet period pays a connect. A machine whose ssh answers but whose
 * daemon idle-stopped gets that daemon started again. Null when unreachable.
 */
export async function machineDaemonSocket(entry: MachineEntry): Promise<string | null> {
  const socketPath = localDaemonSocketPath(entry.alias)
  if (await answers(socketPath)) return socketPath
  // A forward accepts connections even when nothing listens at its far end,
  // so only `hello` proves a daemon is there.
  if (!entry.sockets || !(await forward(entry, entry.sockets))) return null
  if (await answers(socketPath)) return socketPath
  const found = await discoverMachine(entry.alias, entry)
  if (!found.ok) return null
  const sockets = { daemon: found.status.socketPath, pty: found.status.ptySocketPath }
  updateMachine(entry.alias, { sockets, ...(found.roveBin ? { roveBin: found.roveBin } : {}) })
  return (await forward(entry, sockets)) && (await answers(socketPath)) ? socketPath : null
}

function forward(entry: MachineEntry, sockets: { readonly daemon: string; readonly pty: string }): Promise<boolean> {
  return ensureForwards({
    alias: entry.alias,
    config: entry,
    remoteDaemonSocket: sockets.daemon,
    remotePtySocket: sockets.pty,
  })
}

async function answers(socketPath: string): Promise<boolean> {
  const client = new RoveDaemonClient(socketPath)
  try {
    await client.request("hello", {})
    return true
  } catch {
    return false
  } finally {
    client.close()
  }
}

/** A machine's tasks, or null when it cannot be reached. */
export async function machineTasks(entry: MachineEntry): Promise<SerializedTask[] | null> {
  const socketPath = await machineDaemonSocket(entry)
  if (!socketPath) return null
  const client = new RoveDaemonClient(socketPath)
  try {
    const res = await client.request<{ tasks?: SerializedTask[] }>("task.list")
    return res.tasks ?? []
  } catch {
    return null
  } finally {
    client.close()
  }
}

/** The registered machine called `alias`; a typo is a usage error, not a silent local run. */
export function requireMachine(alias: string): MachineEntry {
  const entry = listMachines().find((m) => m.alias === alias)
  if (entry) return entry
  throw new ApiError(`no machine named "${alias}"`, "UNKNOWN_MACHINE", {
    hint: "list the registered machines and retry with one of their aliases, or register it first",
    nextCommandArgs: ["machine", "list"],
  })
}

/** `--machine auto`: let Rove place the work. */
export const AUTO_MACHINE = "auto"

const busy = (tasks: ReadonlyArray<{ readonly status?: string }>): number =>
  tasks.filter((task) => task.status === "in_progress").length

/**
 * Where `--machine auto` sends new work: the machine with the fewest tasks in progress, this one
 * winning ties. A machine that does not answer is skipped. With `hosts`, only the machines it
 * accepts (null = this one) are candidates, e.g. those that have the repo; when it accepts none,
 * load alone decides. `loads` and `skipped` are what was measured, so the caller can say why.
 */
export async function pickMachine(
  localTasks: () => Promise<ReadonlyArray<{ readonly status?: string }>>,
  readTasks: (entry: MachineEntry) => Promise<ReadonlyArray<{ readonly status?: string }> | null> = machineTasks,
  machines: readonly MachineEntry[] = dedupeMachines(listMachines()),
  hosts?: (entry: MachineEntry | null) => Promise<boolean>,
): Promise<{
  readonly entry: MachineEntry | null
  readonly loads: Readonly<Record<string, number>>
  readonly skipped?: readonly string[]
}> {
  const [local, ...remote] = await Promise.all([
    localTasks().catch(() => [] as const),
    ...machines.map((entry) => readTasks(entry)),
  ])
  const loads: Record<string, number> = { [LOCAL_MACHINE]: busy(local) }
  machines.forEach((entry, i) => {
    const tasks = remote[i]
    if (tasks) loads[entry.alias] = busy(tasks)
  })
  let pool: (MachineEntry | null)[] = [null, ...machines.filter((entry) => loads[entry.alias] !== undefined)]
  let skipped: string[] | undefined
  if (hosts) {
    const ok = await Promise.all(pool.map((entry) => hosts(entry).catch(() => false)))
    if (ok.some(Boolean)) {
      skipped = pool.filter((_, i) => !ok[i]).map((entry) => entry?.alias ?? LOCAL_MACHINE)
      pool = pool.filter((_, i) => ok[i])
    }
  }
  let best: MachineEntry | null = null
  let bestLoad = Number.POSITIVE_INFINITY
  for (const entry of pool) {
    const load = loads[entry?.alias ?? LOCAL_MACHINE] ?? 0
    if (load < bestLoad) {
      best = entry
      bestLoad = load
    }
  }
  return { entry: best, loads, ...(skipped ? { skipped } : {}) }
}

/** The identity a `--repo` value names, judged here; null when there is nothing here to compare. */
export function repoWanted(repo: unknown): RepoIdentity | null {
  if (typeof repo !== "string") return null
  const ref = parseRepoRef(repo)
  if (ref.kind === "id") return { origin: ref.id }
  return isLocalCheckout(ref.path) ? repoIdentity(ref.path) : null
}

/**
 * `--machine auto`'s filter: does a machine (null = this one) have the repo `params.repo` names?
 * Undefined — no filter — without a comparable `--repo`, or with `--clone` (any machine can fetch it).
 */
export function repoHosts(params: ApiParams): ((entry: MachineEntry | null) => Promise<boolean>) | undefined {
  if (flagOn(params.clone)) return undefined
  const want = repoWanted(params.repo)
  if (!want || (!want.origin && !want.root)) return undefined
  return async (entry) => {
    if (entry === null) {
      if (typeof params.repo === "string" && parseRepoRef(params.repo).kind === "path") return true
      return getSavedRepos().some((path) => findCheckouts(want, [{ path, identity: repoIdentity(path) ?? {} }]).length)
    }
    const socket = await machineDaemonSocket(entry)
    if (!socket) return false
    const client = new RoveDaemonClient(socket)
    try {
      const res = await client.request<ApiEnvelope>("api.invoke", {
        verb: "repo-match",
        params: { ...(want.origin ? { origin: want.origin } : {}), ...(want.root ? { root: want.root } : {}) },
        forwarded: true,
        from: hostname(),
      })
      return res.ok && Boolean((res.result as { repo?: string | null }).repo)
    } finally {
      client.close()
    }
  }
}

/**
 * Which machine a verb should run on: the explicit `--machine`, else the
 * machine holding `--task-id`, else null (this machine). A task id this
 * daemon knows is answered here without touching any other machine.
 */
export async function routeTarget(args: {
  readonly machine?: string
  readonly taskId?: string
  readonly isLocalTask: (taskId: string) => Promise<boolean>
  /** This machine's tasks, for `--machine auto`'s load comparison. */
  readonly localTasks?: () => Promise<ReadonlyArray<{ readonly status?: string }>>
  /** The verb's params: `--machine auto` only places where the `--repo` they name is. */
  readonly params?: ApiParams
}): Promise<MachineEntry | null> {
  if (args.machine === AUTO_MACHINE) {
    const hosts = args.params ? repoHosts(args.params) : undefined
    return (await pickMachine(args.localTasks ?? (async () => []), machineTasks, undefined, hosts)).entry
  }
  if (args.machine !== undefined && args.machine !== LOCAL_MACHINE) return requireMachine(args.machine)
  if (args.machine === LOCAL_MACHINE || !args.taskId) return null
  const machines = dedupeMachines(listMachines())
  if (machines.length === 0 || (await args.isLocalTask(args.taskId))) return null
  for (const entry of machines) {
    const tasks = await machineTasks(entry)
    if (tasks?.some((task) => task.id === args.taskId)) return entry
  }
  return null
}

/** Run `verb` inside `entry`'s daemon. Never rejects: failures come back as an error envelope. */
export async function forwardVerb(
  entry: MachineEntry,
  verb: string,
  params: ApiParams,
  socketPath?: string,
): Promise<ApiEnvelope> {
  const target = socketPath ?? (await machineDaemonSocket(entry))
  if (!target) return offline(entry.alias)
  const client = new RoveDaemonClient(target)
  try {
    const repo = await translateRepo(client, entry.alias, params)
    if (repo.failure) return repo.failure
    // Merging into a base checkout only makes sense where that checkout is; from a hub,
    // landing another machine's task means sending its branch back through the remote.
    if (verb === "land" && params["dry-run"] === undefined) {
      const published = await client.request<ApiEnvelope>("api.invoke", {
        verb: "publish",
        params: { "task-id": params["task-id"] } as ApiParams,
        forwarded: true,
        from: hostname(),
      })
      if (published.ok || published.error.code !== "UNKNOWN_VERB") return published
    }
    return await client.request<ApiEnvelope>("api.invoke", {
      verb,
      params: repo.params,
      forwarded: true,
      from: hostname(),
    })
  } catch (err) {
    const message = errorMessage(err)
    if (/unknown daemon request:/i.test(message)) return tooOld(entry.alias)
    return failure("MACHINE_UNREACHABLE", `machine "${entry.alias}": ${message}`, {
      hint: "check the machine is up and reachable over ssh, then retry",
      nextCommandArgs: ["machine", "list"],
    })
  } finally {
    client.close()
  }
}

/**
 * `--repo` naming a checkout on THIS machine means "that repo", not that path: the target is
 * asked for its own checkout of it (`repo-match`) and the path swapped. A path that is not a
 * checkout here passes through as the target's own path, as before. A repo id (`owner/name`,
 * a URL) is matched by origin the same way, with or without a checkout here. A target too old
 * to know `repo-match` gets the value unchanged.
 */
async function translateRepo(
  client: RoveDaemonClient,
  alias: string,
  params: ApiParams,
): Promise<{ params: ApiParams; failure?: undefined } | { failure: ApiEnvelope }> {
  const repo = params.repo
  if (typeof repo !== "string") return { params }
  const ref = parseRepoRef(repo)
  const local = ref.kind === "path" && isLocalCheckout(ref.path)
  if (ref.kind === "path" && !local) return { params }
  const identity: RepoIdentity | null = ref.kind === "id" ? { origin: ref.id } : repoIdentity(repo)
  if (!identity?.origin && !identity?.root) return { params }
  const allowFork = flagOn(params["allow-fork"])
  const ask = await client.request<ApiEnvelope>("api.invoke", {
    verb: "repo-match",
    params: {
      ...(identity.origin ? { origin: identity.origin } : {}),
      ...(identity.root ? { root: identity.root } : {}),
      ...(allowFork ? { "allow-fork": true } : {}),
    },
    forwarded: true,
    from: hostname(),
  })
  if (!ask.ok) return ask.error.code === "UNKNOWN_VERB" ? { params } : { failure: ask }
  const answer = ask.result as { repo?: string | null; fork?: string }
  const found = answer.repo
  if (found) {
    // The runner only has what was pushed: a base with commits no remote has cannot be built on there.
    const base = params["base-branch"]
    const unpushed = local && typeof base === "string" ? unpushedCommits(repo, base) : null
    if (typeof base === "string" && unpushed) {
      return {
        failure: failure(
          "UNPUSHED_BASE",
          `${base} has ${unpushed} commit${unpushed === 1 ? "" : "s"} no remote has; ${alias} cannot base a task on it`,
          { hint: `push it first (\`git -C ${repo} push -u origin ${base}\`), then dispatch again` },
        ),
      }
    }
    return { params: { ...params, repo: found } }
  }
  if (answer.fork) {
    return {
      failure: failure(
        "FORK_MATCH",
        `machine "${alias}" only has ${answer.fork}, a fork of ${identity.origin ?? repo} (same history, other origin)`,
        { hint: "pass --allow-fork to use it, or --clone with the repo id to fetch the repo itself there" },
      ),
    }
  }
  // The target lacks it: with --clone it fetches the repo itself (`add` resolves the id there).
  if (flagOn(params.clone) && identity.origin) {
    return { params: { ...params, repo: ref.kind === "id" ? repo : identity.origin } }
  }
  return {
    failure: failure("NO_REMOTE_CHECKOUT", `machine "${alias}" has no checkout of ${identity.origin ?? repo}`, {
      hint: identity.origin
        ? `pass --clone to clone it on ${alias}, or --repo with ${alias}'s own path`
        : `clone it on ${alias} (and open it there once so Rove knows it), or pass --repo with ${alias}'s own path`,
    }),
  }
}

const flagOn = (value: unknown): boolean => value === true || value === "true"

function offline(alias: string): ApiEnvelope {
  return failure("MACHINE_UNREACHABLE", `machine "${alias}" did not answer`, {
    hint: `check \`ssh ${alias} true\` works without a prompt, then retry`,
    nextCommandArgs: ["machine", "list"],
  })
}

function tooOld(alias: string): ApiEnvelope {
  return failure("MACHINE_VERSION_SKEW", `machine "${alias}" runs a Rove too old to accept forwarded verbs`, {
    hint: `upgrade Rove on ${alias} (\`rove update\` there), then retry`,
  })
}

function failure(code: string, message: string, data: Record<string, unknown>): ApiEnvelope {
  return { apiVersion: ROVE_API_VERSION, ok: false, error: { message, code, ...data } }
}

/**
 * The routing step every `api.invoke` server shares (daemon, bridge): forward
 * to the machine the call names or whose task it targets, else run here.
 */
export async function invokeRouted(args: {
  readonly verb: string
  readonly params: ApiParams
  readonly machine?: string
  readonly forwarded?: boolean
  readonly isLocalTask: (taskId: string) => Promise<boolean>
  readonly localTasks?: () => Promise<ReadonlyArray<{ readonly status?: string }>>
  readonly runHere: () => Promise<ApiEnvelope>
}): Promise<ApiEnvelope> {
  if (args.forwarded) return args.runHere()
  const taskId = args.params["task-id"]
  let target: MachineEntry | null
  try {
    target = await routeTarget({
      machine: args.machine,
      taskId: typeof taskId === "string" ? taskId : undefined,
      isLocalTask: args.isLocalTask,
      ...(args.localTasks ? { localTasks: args.localTasks } : {}),
      params: args.params,
    })
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    return failure(err.code, err.message, err.data ?? {})
  }
  return target ? forwardVerb(target, args.verb, args.params) : args.runHere()
}

/** The local end of `alias`'s forwarded PTY-host socket, once its tunnel is up. */
export async function machinePtySocket(alias: string): Promise<string> {
  const entry = requireMachine(alias)
  // Both forwards go up together: a live daemon socket means the PTY socket is live too.
  if (!(await machineDaemonSocket(entry))) {
    throw new ApiError(`machine "${alias}" did not answer`, "MACHINE_UNREACHABLE")
  }
  return localPtySocketPath(alias)
}

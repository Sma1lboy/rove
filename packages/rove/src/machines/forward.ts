/**
 * Run a `rove api` verb on another machine: the verb crosses the forwarded
 * daemon socket as `api.invoke`, so it executes inside THAT machine's daemon —
 * its git, its PTY host, its engine logins. This machine only routes.
 *
 * A forwarded call carries `forwarded: true` and is never routed again, so two
 * machines that registered each other cannot bounce a verb between them.
 */

import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import {
  type ApiEnvelope,
  type ApiParams,
  ROVE_API_VERSION,
  type SerializedTask,
} from "@sma1lboy/rove-daemon/daemon/protocol"
import { ApiError } from "../cli/api/types.ts"
import { errorMessage } from "../lib/error-message.ts"
import { discoverMachine } from "./discover.ts"
import { type MachineEntry, dedupeMachines, listMachines, updateMachine } from "./registry.ts"
import { isLocalCheckout, repoIdentity } from "./repo-identity.ts"
import { localDaemonSocketPath } from "./ssh-args.ts"
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

/**
 * Which machine a verb should run on: the explicit `--machine`, else the
 * machine holding `--task-id`, else null (this machine). A task id this
 * daemon knows is answered here without touching any other machine.
 */
export async function routeTarget(args: {
  readonly machine?: string
  readonly taskId?: string
  readonly isLocalTask: (taskId: string) => Promise<boolean>
}): Promise<MachineEntry | null> {
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
    return await client.request<ApiEnvelope>("api.invoke", { verb, params: repo.params, forwarded: true })
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
 * checkout here passes through as the target's own path, as before. A target too old to know
 * `repo-match` gets the path unchanged.
 */
async function translateRepo(
  client: RoveDaemonClient,
  alias: string,
  params: ApiParams,
): Promise<{ params: ApiParams; failure?: undefined } | { failure: ApiEnvelope }> {
  const repo = params.repo
  if (typeof repo !== "string" || !isLocalCheckout(repo)) return { params }
  const identity = repoIdentity(repo)
  if (!identity?.origin && !identity?.root) return { params }
  const ask = await client.request<ApiEnvelope>("api.invoke", {
    verb: "repo-match",
    params: {
      ...(identity.origin ? { origin: identity.origin } : {}),
      ...(identity.root ? { root: identity.root } : {}),
    },
    forwarded: true,
  })
  if (!ask.ok) return ask.error.code === "UNKNOWN_VERB" ? { params } : { failure: ask }
  const found = (ask.result as { repo?: string | null }).repo
  if (found) return { params: { ...params, repo: found } }
  return {
    failure: failure("NO_REMOTE_CHECKOUT", `machine "${alias}" has no checkout of ${identity.origin ?? repo}`, {
      hint: `clone it on ${alias} (and open it there once so Rove knows it), or pass --repo with ${alias}'s own path`,
    }),
  }
}

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
    })
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    return failure(err.code, err.message, err.data ?? {})
  }
  return target ? forwardVerb(target, args.verb, args.params) : args.runHere()
}

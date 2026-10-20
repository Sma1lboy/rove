/**
 * Center and worker. Every machine runs the same daemon; `fleet.centers`
 * names which ones may schedule, in failover order. A call for `--machine
 * any|auto` goes to the first candidate that answers, and that center probes
 * its workers and hands the task to one of them.
 *
 * The center holds no state of its own — tasks live on the workers, the
 * worker list is each center's machine registry — so failover is "ask the
 * next candidate" and needs no election protocol: two centers answering at
 * once (a network split) can only both place tasks, never disagree about one.
 */

import { existsSync } from "node:fs"
import { isAbsolute } from "node:path"
import { type ApiEnvelope, type ApiParams, ROVE_API_VERSION } from "@sma1lboy/rove-daemon/daemon/protocol"
import { failure, forwardVerb, invokeOn, machineDaemonSocket } from "../machines/forward.ts"
import { type MachineEntry, dedupeMachines, listMachines } from "../machines/registry.ts"
import { type FleetConfig, readFleetConfig } from "./config.ts"
import type { NodeStatus } from "./node-status.ts"
import { readRepoRemote } from "./repo-remote.ts"
import { askRouter } from "./router.ts"
import { type Candidate, type ScheduleMode, pickNode } from "./schedule.ts"

const FLEET_TARGETS: ReadonlySet<string> = new Set(["any", "auto"])

/** A node slower than this is skipped, so one stuck worker cannot stall the center. */
const PROBE_TIMEOUT_MS = 5000

/** The alias a center gives itself among its candidates. */
const SELF = "local"

/** Only `add` places a task; every other verb follows the task it names. */
const SCHEDULED_VERBS: ReadonlySet<string> = new Set(["add"])

export function isFleetTarget(machine: string | undefined): machine is ScheduleMode {
  return machine !== undefined && FLEET_TARGETS.has(machine)
}

function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

export type CenterChoice =
  | { readonly kind: "self" }
  | { readonly kind: "remote"; readonly entry: MachineEntry; readonly socketPath: string }

/**
 * The center for this call: the first of `fleet.centers` that answers,
 * skipping `skip`. No list = this machine is its own center. Null when no
 * candidate answers.
 */
export async function electCenter(
  config: FleetConfig = readFleetConfig(),
  skip: ReadonlySet<string> = new Set(),
): Promise<CenterChoice | null> {
  if (config.centers.length === 0) return { kind: "self" }
  const machines = listMachines()
  for (const alias of config.centers) {
    if (skip.has(alias)) continue
    if (alias === SELF) return { kind: "self" }
    const entry = machines.find((m) => m.alias === alias)
    if (!entry) continue
    const socketPath = await within(machineDaemonSocket(entry), PROBE_TIMEOUT_MS, null)
    if (socketPath) return { kind: "remote", entry, socketPath }
  }
  return null
}

/** `--repo` as an absolute path here → its normalized `origin`. */
async function remoteOfRepoParam(params: ApiParams): Promise<string | undefined> {
  const repo = params.repo
  if (typeof repo !== "string" || !isAbsolute(repo)) return undefined
  return (await readRepoRemote(repo)) ?? undefined
}

/**
 * `--machine any|auto`: find a center that answers and let it schedule. A
 * center that drops mid-call is skipped and the next candidate asked.
 */
export async function dispatchToFleet(args: {
  readonly mode: ScheduleMode
  readonly verb: string
  readonly params: ApiParams
  readonly viaCenter?: boolean
  readonly repoRemote?: string
  readonly runHere: (verb: string, params: ApiParams) => Promise<ApiEnvelope>
}): Promise<ApiEnvelope> {
  if (!SCHEDULED_VERBS.has(args.verb)) {
    return failure("BAD_FLAG", `--machine ${args.mode} places a new task; ${args.verb} follows the task it names`, {
      hint: "pass --task-id (the task's machine is found for you) or --machine <alias>",
    })
  }
  const repoRemote = args.repoRemote ?? (await remoteOfRepoParam(args.params))
  if (args.viaCenter) return schedule({ ...args, repoRemote, callerHere: false })
  const config = readFleetConfig()
  const skip = new Set<string>()
  for (;;) {
    const center = await electCenter(config, skip)
    if (!center) {
      return failure("NO_CENTER", `no fleet center answered (tried ${config.centers.join(", ")})`, {
        hint: "check the machines in fleet.centers are up, or add `local` to the list so this machine can schedule",
        nextCommandArgs: ["api", "fleet-status"],
      })
    }
    if (center.kind === "self") return schedule({ ...args, repoRemote, callerHere: true })
    const envelope = await invokeOn(
      center.entry,
      {
        verb: args.verb,
        params: args.params,
        machine: args.mode,
        viaCenter: true,
        ...(repoRemote ? { repoRemote } : {}),
      },
      center.socketPath,
    )
    if (envelope.ok || envelope.error.code !== "MACHINE_UNREACHABLE") return envelope
    skip.add(center.entry.alias)
  }
}

/** A task id no machine here knows: the center may know which worker has it. */
export async function askCenterForTask(verb: string, params: ApiParams): Promise<ApiEnvelope | undefined> {
  const config = readFleetConfig()
  if (config.centers.length === 0) return undefined
  const center = await electCenter(config)
  if (center?.kind !== "remote") return undefined
  return invokeOn(center.entry, { verb, params, viaCenter: true }, center.socketPath)
}

interface Probe {
  readonly alias: string
  readonly entry?: MachineEntry
  readonly status: NodeStatus | null
  readonly why?: string
}

function statusOf(envelope: ApiEnvelope): { status: NodeStatus | null; why?: string } {
  if (envelope.ok) return { status: envelope.result as NodeStatus }
  if (envelope.error.code === "BAD_VERB" || envelope.error.code === "MACHINE_VERSION_SKEW") {
    return { status: null, why: "runs a Rove without node-status (update it)" }
  }
  return { status: null, why: envelope.error.message }
}

const NO_ANSWER: ApiEnvelope = {
  apiVersion: ROVE_API_VERSION,
  ok: false,
  error: { code: "TIMEOUT", message: "did not answer in time" },
}

/** This machine and every registered worker, probed in parallel. */
export async function probeFleet(runHere: (verb: string, params: ApiParams) => Promise<ApiEnvelope>): Promise<Probe[]> {
  const machines = dedupeMachines(listMachines())
  const probes = [
    within(runHere("node-status", {}), PROBE_TIMEOUT_MS, NO_ANSWER).then((env) => ({ alias: SELF, ...statusOf(env) })),
    ...machines.map((entry) =>
      within(forwardVerb(entry, "node-status", {}), PROBE_TIMEOUT_MS, NO_ANSWER).then((env) => ({
        alias: entry.alias,
        entry,
        ...statusOf(env),
      })),
    ),
  ]
  return Promise.all(probes)
}

function withRepo(status: NodeStatus, path: string, remote: string | undefined): NodeStatus {
  if (status.repos.some((r) => r.path === path)) return status
  return { ...status, repos: [...status.repos, remote ? { path, remote } : { path }] }
}

/** The center's half: probe, pick, run there with the repo path that node uses. */
async function schedule(args: {
  readonly mode: ScheduleMode
  readonly verb: string
  readonly params: ApiParams
  readonly repoRemote?: string
  /** The call started on this machine, so its `--repo` path is a checkout here. */
  readonly callerHere: boolean
  readonly runHere: (verb: string, params: ApiParams) => Promise<ApiEnvelope>
}): Promise<ApiEnvelope> {
  const config = readFleetConfig()
  const repoPath = typeof args.params.repo === "string" ? args.params.repo : undefined
  const probes = (await probeFleet(args.runHere)).map((p) =>
    args.callerHere && repoPath && p.alias === SELF && p.status && (args.repoRemote || existsSync(repoPath))
      ? { ...p, status: withRepo(p.status, repoPath, args.repoRemote) }
      : p,
  )
  const candidates: Candidate[] = probes.map((p) => ({
    alias: p.alias,
    status: p.status,
    ...(p.why ? { why: p.why } : {}),
    isCenter: p.alias === SELF,
  }))
  const prompt = typeof args.params.prompt === "string" ? args.params.prompt : undefined
  const routed =
    args.mode === "auto" && config.router && prompt
      ? await askRouter({
          url: config.router,
          timeoutMs: config.routerTimeoutMs,
          prompt,
          nodes: probes.flatMap((p) => (p.status ? [{ alias: p.alias, status: p.status }] : [])),
        })
      : undefined
  const engine = typeof args.params.vendor === "string" ? args.params.vendor : undefined
  const verdict = pickNode({
    mode: args.mode,
    candidates,
    ...(args.repoRemote ? { repoRemote: args.repoRemote } : repoPath ? { repoPath } : {}),
    ...(engine ? { engine } : {}),
    ...(prompt ? { prompt } : {}),
    ...(routed ? { routed } : {}),
    centerTakesTasks: config.centerTakesTasks,
  })
  if (!verdict.ok) {
    return failure("NO_ELIGIBLE_NODE", "no machine in the fleet can take this task", {
      rejected: verdict.rejected.map((r) => ({ machine: r.alias, why: r.why })),
      hint: "each machine needs a checkout of the repo (same origin), the engine, and room under engine.maxLiveSessions",
      nextCommandArgs: ["api", "fleet-status"],
    })
  }
  const params = verdict.repo ? { ...args.params, repo: verdict.repo } : args.params
  const probe = probes.find((p) => p.alias === verdict.alias)
  const envelope = probe?.entry
    ? await forwardVerb(probe.entry, args.verb, params)
    : await args.runHere(args.verb, params)
  if (!envelope.ok || typeof envelope.result !== "object" || envelope.result === null) return envelope
  const dispatch = {
    machine: verdict.alias,
    host: probe?.status?.hostname,
    reason: verdict.reason,
    ...(verdict.rejected.length ? { skipped: verdict.rejected.map((r) => ({ machine: r.alias, why: r.why })) } : {}),
  }
  return { ...envelope, result: { ...envelope.result, dispatch } }
}

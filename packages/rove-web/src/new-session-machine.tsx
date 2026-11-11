/** The New session composer's other-machine parts: the machine chip, that machine's project list, a branch chip that takes a typed ref, and Start there. */

import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { useEffect, useState } from "react"
import { BridgeRequestError } from "./bridge.ts"
import { t, useLocale } from "./i18n/index.ts"
import { type MachineRow, machineLabel, useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { ChipPopover, ChoiceMenu, SearchList } from "./new-session-menus.tsx"
import {
  type RemoteEngine,
  type RemotePick,
  type RemoteRepo,
  type RemoteStartInput,
  carriedPick,
  enginesThere,
  remoteSpawnArgs,
  seedRemotePick,
} from "./new-session-remote.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { tc } from "./tui-copy.ts"
import { ICON, chipClass } from "./ui/composer.ts"

/** The i18n key for each `machines.repos` reason that has a line of its own; any other reason shows the machine's message. */
const REASON_COPY: Readonly<Record<string, string>> = {
  offline: "newSession.remoteOffline",
  outdated: "newSession.remoteOutdated",
}

/** `machines.repos` for this machine: its repos by id, to find a project picked here on another machine. */
export const LOCAL = "local"

interface RemoteReply {
  readonly repos: readonly RemoteRepo[]
  readonly reason?: string
  readonly message?: string
}

export interface RemoteRepos {
  readonly repos: readonly RemoteRepo[]
  readonly loaded: boolean
  /** Why the list is empty when it could not be read; "" otherwise. */
  readonly problem: string
}

const readRepos = (model: AppModel, machine: string): Promise<RemoteReply> =>
  requestRemembered<RemoteReply>(model, "machines.repos", { machine })

/** Read every online machine's project list, and this one's by id (`local`), before one is picked. */
export function usePrefetchRemoteRepos(model: AppModel, machines: readonly MachineRow[]): void {
  const online = machines
    .filter((m) => m.state === "online")
    .map((m) => m.alias)
    .join("\n")
  useEffect(() => {
    for (const alias of online ? [LOCAL, ...online.split("\n")] : []) void readRepos(model, alias).catch(() => {})
  }, [model, online])
}

interface EnginesReply {
  readonly engines: readonly RemoteEngine[]
}

/** The engines `machine` lists, each with whether its CLI is there: none until it answers, when it cannot say, or for this machine (""). */
export function useRemoteEngines(model: AppModel, machine: string): readonly RemoteEngine[] {
  const [state, setState] = useState<{ readonly machine: string; readonly reply: EnginesReply } | null>(null)
  useEffect(() => {
    if (!machine) return
    let stale = false
    requestRemembered<EnginesReply>(model, "machines.engines", { machine })
      .then((reply) => !stale && setState({ machine, reply }))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [model, machine])
  if (!machine) return []
  const reply =
    state?.machine === machine ? state.reply : lastReply<EnginesReply>(model, "machines.engines", { machine })
  return reply?.engines ?? []
}

/** The engine chip's choice on `machine`: its engines once it lists them, and the first it has when it lacks the picked one. `missing` is undefined for this machine (""). */
export function useEnginesOn<E extends { readonly id: string; readonly name: string }>(
  model: AppModel,
  machine: string,
  choice: { readonly engines: readonly E[]; readonly engine: string; readonly setEngine: (id: string) => void },
) {
  const there = enginesThere(choice.engines, useRemoteEngines(model, machine))
  const usable = there.rows.filter((e) => !there.missing.has(e.id))
  const engine = usable.some((e) => e.id === choice.engine) ? choice.engine : (usable[0]?.id ?? choice.engine)
  return { engines: there.rows, engine, setEngine: choice.setEngine, missing: machine ? there.missing : undefined }
}

/**
 * Keeps the project across a machine switch. Call the result at the switch with the machine left (`LOCAL` for this
 * one; "" carries nothing) and the pick there; once both lists are in, `onPick` gets the pick on the new machine.
 */
export function useCarriedPick(
  model: AppModel,
  list: RemoteRepos,
  onPick: (pick: RemotePick | null) => void,
): (from: string, ref: string | undefined) => void {
  const [carry, setCarry] = useState<{ readonly from: string; readonly ref: string } | null>(null)
  const fromList = useRemoteRepos(model, carry?.from ?? "")
  useEffect(() => {
    if (!carry || !fromList.loaded || !list.loaded) return
    // A machine that could not list its repos is not asked to clone one.
    if (!list.problem) onPick(carriedPick(carry.ref, fromList.repos, list.repos))
    setCarry(null)
  }, [carry, fromList, list, onPick])
  return (from, ref) => setCarry(from && ref ? { from, ref } : null)
}

/**
 * The composer's other-machine state: which machine ("" = this one), its project list and the pick there,
 * the ref to branch from, and whether the engine runs there too (off: the agent is this machine's).
 */
export function useRemoteTarget<E extends { readonly id: string; readonly name: string }>(
  model: AppModel,
  seed: { readonly machine?: string | undefined; readonly repo?: string | undefined },
  choice: { readonly engines: readonly E[]; readonly engine: string; readonly setEngine: (id: string) => void },
) {
  const machines = useMachines(model)
  const [machine, setMachine] = useState(seed.machine ?? "")
  const remoteList = useRemoteRepos(model, machine)
  const [engineThere, setEngineThere] = useState(false)
  const shown = useEnginesOn(model, engineThere ? machine : "", choice)
  usePrefetchRemoteRepos(model, machines)
  const [pick, setPick] = useState<RemotePick | null>(null)
  const [base, setBase] = useState("")
  const carry = useCarriedPick(model, remoteList, (carried) => setPick((now) => now ?? carried))
  // The project a rail row named on another machine is picked once that machine's list is in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeded once per list load; a later pick or machine switch stands
  useEffect(() => {
    if (!machine || !remoteList.loaded || machine !== seed.machine) return
    setPick((now) => now ?? seedRemotePick(seed.repo, remoteList.repos))
  }, [remoteList.loaded])
  return {
    machines,
    machine,
    remote: machine !== "",
    machineName: machines.find((m) => m.alias === machine)?.hostLabel || machine,
    remoteList,
    engineThere,
    toggleEngineThere: () => setEngineThere((on) => !on),
    shown,
    pick,
    setPick,
    base,
    setBase,
    /** Switch machines, carrying the project picked on the one left (`localPick` when that is this machine). */
    switchTo(alias: string, localPick: string): void {
      carry(alias && (machine || LOCAL), machine ? pick?.ref : localPick)
      setMachine(alias)
      setPick(null)
      setBase("")
    },
  }
}

/** `machine`'s repos by id, from the prefetched list while it rereads; nothing is asked for this machine (""). */
export function useRemoteRepos(model: AppModel, machine: string): RemoteRepos {
  useLocale()
  const [state, setState] = useState<{
    readonly machine: string
    readonly reply: RemoteReply | null
    readonly failed: string
  } | null>(null)
  useEffect(() => {
    if (!machine) return
    let stale = false
    readRepos(model, machine)
      .then((reply) => !stale && setState({ machine, reply, failed: "" }))
      .catch((err: unknown) => !stale && setState({ machine, reply: null, failed: String(err) }))
    return () => {
      stale = true
    }
  }, [model, machine])
  if (!machine) return { repos: [], loaded: true, problem: "" }
  // A reply for the machine picked before this one is not this one's list.
  const live = state?.machine === machine ? state : undefined
  const cached = lastReply<RemoteReply>(model, "machines.repos", { machine })
  if (!live && !cached) return { repos: [], loaded: false, problem: "" }
  const reply = live ? live.reply : (cached as RemoteReply)
  if (!reply)
    return { repos: [], loaded: true, problem: t("newSession.remoteFailed", { machine, message: live?.failed ?? "" }) }
  const key = reply.reason ? REASON_COPY[reply.reason] : undefined
  const problem = reply.reason
    ? key
      ? t(key, { machine })
      : t("newSession.remoteFailed", { machine, message: reply.message ?? reply.reason })
    : ""
  return { repos: reply.repos, loaded: true, problem }
}

export function remoteEmpty(machine: string, list: RemoteRepos): string {
  if (list.problem) return list.problem
  return list.loaded ? t("newSession.remoteNone", { machine }) : t("newSession.remoteLoading", { machine })
}

function MachineIcon() {
  return (
    <svg className={ICON} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M5.5 13.5h5M8 11v2.5" />
    </svg>
  )
}

/** This machine, then every registered one; a machine that is not online is listed with its state and cannot be picked. */
export function MachineChip(props: {
  machines: readonly MachineRow[]
  /** The picked machine's alias; "" = this machine. */
  value: string
  onPick: (alias: string) => void
}) {
  const words = (useLocale() === "zh" ? tasksZh : tasksEn).machine
  const row = props.machines.find((m) => m.alias === props.value)
  const name = props.value ? row?.hostLabel || props.value : t("newSession.thisMachine")
  return (
    <ChipPopover
      field="machine"
      title={t("newSession.machine")}
      label={
        <>
          <MachineIcon />
          {name}
        </>
      }
    >
      {(close) => (
        <ChoiceMenu
          heading={t("newSession.machine")}
          options={[
            { id: "", label: t("newSession.thisMachine") },
            ...props.machines.map((m) => ({
              id: m.alias,
              label: machineLabel(m, words),
              disabled: m.state !== "online",
            })),
          ]}
          value={props.value}
          digits
          onPick={(id) => {
            props.onPick(id)
            close()
          }}
        />
      )}
    </ChipPopover>
  )
}

/** Off (the default): the agent is this machine's and only the work is on `machine`. On: the engine runs there too. */
export function EngineThereToggle(props: { machine: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={chipClass(props.on)}
      data-field="engine-there"
      aria-pressed={props.on}
      title={t(props.on ? "newSession.engineThereOn" : "newSession.engineThereOff", { machine: props.machine })}
      onClick={props.onToggle}
    >
      {t("newSession.engineThere")}
    </button>
  )
}

/** The ref a task on another machine branches from: that machine's current branch, or a ref typed here (this page cannot list its branches). */
export function RemoteBranchChip(props: { value: string; onPick: (ref: string) => void }) {
  const [query, setQuery] = useState("")
  const typed = query.trim()
  return (
    <ChipPopover field="branch" title={t("newSession.branch")} label={props.value || t("newSession.branch")}>
      {(close) => (
        <SearchList
          placeholder={t("newSession.branchTypeRef")}
          empty=""
          rows={[{ key: "", text: t("newSession.branchRemoteDefault"), checked: props.value === "" }]}
          query={query}
          onQuery={setQuery}
          extra={typed ? { key: typed, text: typed, checked: props.value === typed } : null}
          onPick={(ref) => {
            props.onPick(ref)
            setQuery("")
            close()
          }}
        />
      )}
    </ChipPopover>
  )
}

/** Start on another machine through `task.spawn`: that machine's `add` runs there (cloning first when asked) with its own credentials. Resolves to the new task's id. */
export async function spawnOnMachine(model: AppModel, input: RemoteStartInput): Promise<string | undefined> {
  const res = await model.client.request<{ taskIds: string[] }>("task.spawn", remoteSpawnArgs(input))
  return res.taskIds[0]
}

/** A refusal in the composer's slot: git error's own words for a failed clone, the machine's message otherwise. */
export function startError(err: unknown): string {
  if (err instanceof BridgeRequestError && err.code === "CLONE_FAILED") {
    return tc("newTask", "error.cloneFailed", { error: err.message })
  }
  return err instanceof Error ? err.message : String(err)
}

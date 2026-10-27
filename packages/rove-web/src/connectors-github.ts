/**
 * Settings → Connectors → GitHub: what each machine's `gh` says. Rove's account is this machine's own
 * login; a machine's row is a mark comparing its account to that one. The bridge answers a machine it
 * cannot reach with a `reason`, not an error, so every row has a state to show.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { errorText } from "./dialogs.tsx"
import { type MachineRow, useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { toast } from "./ui.ts"

export interface LoginState {
  readonly state: "pending" | "syncing" | "failed"
  readonly code?: string
  readonly url?: string
  readonly error?: string
}

export interface GithubStatus {
  readonly git: string | null
  readonly gh: string | null
  readonly account: string | null
  readonly authDetail?: string
  readonly protocol: "https" | "ssh" | null
  readonly gitUsesGh: boolean
  readonly ssh: { readonly ok: boolean; readonly user?: string; readonly detail?: string }
  readonly login: LoginState | null
}

export type FailReason = "offline" | "outdated" | "denied" | "failed"

/** One machine's answer; `status` is null when it could not give one. */
export interface Probe {
  readonly status: GithubStatus | null
  readonly reason?: FailReason
  readonly message?: string
}

type Outcome = { ok: true; result: unknown } | { ok: false; reason: FailReason; message: string }

export type Mark =
  | "loading"
  | "same"
  | "different"
  | "signedOut"
  | "noGh"
  | "outdated"
  | "offline"
  | "denied"
  | "failed"

/** This machine's key in the probe table; a remote machine's key is its alias. */
export const LOCAL = ""

/** How a machine's GitHub sign-in compares to Rove's account. */
export function markOf(probe: Probe | undefined, machine: MachineRow["state"] | null, rove: string | null): Mark {
  if (machine === "offline") return "offline"
  if (machine === "unsupported" || machine === "mismatch") return "outdated"
  if (!probe) return "loading"
  const status = probe.status
  if (!status) return probe.reason === "failed" || !probe.reason ? "failed" : probe.reason
  if (!status.gh) return "noGh"
  if (!status.account) return "signedOut"
  return status.account === rove ? "same" : "different"
}

const POLL_MS = 2000
export const loginBusy = (status: GithubStatus | null | undefined): boolean =>
  status?.login?.state === "pending" || status?.login?.state === "syncing"

export function useGithubConnector(model: AppModel) {
  const { client } = model
  const machines = useMachines(model)
  const [probes, setProbes] = useState<Readonly<Record<string, Probe>>>({})
  const onlineKey = machines.flatMap((m) => (m.state === "online" ? [m.alias] : [])).join("\n")
  const online = useMemo(() => (onlineKey ? onlineKey.split("\n") : []), [onlineKey])
  const busyBefore = useRef(new Set<string>())

  const probe = useCallback(
    async (key: string): Promise<void> => {
      const args = key === LOCAL ? {} : { machine: key }
      const next = await client
        .request<Probe>("github.status", args)
        .catch((e): Probe => ({ status: null, reason: "failed", message: errorText(e) }))
      setProbes((p) => ({ ...p, [key]: next }))
    },
    [client],
  )

  const refresh = useCallback(() => Promise.all([LOCAL, ...online].map(probe)).then(() => {}), [probe, online])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll only the machines mid sign-in. One that just finished may have signed others in: look at all again.
  useEffect(() => {
    const busy = new Set(Object.entries(probes).flatMap(([key, p]) => (loginBusy(p.status) ? [key] : [])))
    const finished = [...busyBefore.current].some((key) => !busy.has(key))
    busyBefore.current = busy
    if (finished) void refresh()
    if (busy.size === 0) return
    const timer = window.setTimeout(() => {
      for (const key of busy) void probe(key)
    }, POLL_MS)
    return () => window.clearTimeout(timer)
  }, [probes, probe, refresh])

  const act = useCallback(
    async (op: string, args: Record<string, unknown>): Promise<Outcome | null> => {
      try {
        const out = await client.request<Outcome>(op, args)
        if (!out.ok) toast(out.message, "error")
        return out
      } catch (e) {
        toast(errorText(e), "error")
        return null
      }
    },
    [client],
  )

  return { machines, probes, refresh, probe, act }
}

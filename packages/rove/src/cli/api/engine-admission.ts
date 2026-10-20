import { basename } from "node:path"
import type { PtyCheckedOpenResult, PtyOpenResult } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { PtySessionInfo, PtySpawnSpec } from "@sma1lboy/rove-daemon/daemon/pty-host"
import {
  type PsSnapshot,
  engineProcessIn,
  parsePsSnapshot,
  psSnapshot,
  vendorFromArgv,
} from "../../engine/foreground.ts"
import { type HostedSessionRpc, sessionArgvNamesEngine } from "../../engine/hosted-session.ts"
import { readTabsSnapshot } from "./tab-snapshot.ts"
import { ApiError } from "./types.ts"

/** A pending launch still owns its slot; keepAlive's bare shell does not. */
export async function countLiveEngineSessions(
  sessions: readonly PtySessionInfo[],
  snapshot: PsSnapshot = psSnapshot,
): Promise<number> {
  const tabs = sessions.filter((s) => s.alive && s.key.split("::").length === 2)
  if (!tabs.length) return 0
  let rows: ReturnType<typeof parsePsSnapshot>
  try {
    rows = parsePsSnapshot(await snapshot(tabs.flatMap((s) => (s.pid ? [s.pid] : []))))
    if (!rows.length) return tabs.length
  } catch {
    // An unavailable probe must never make room for another launch.
    return tabs.length
  }
  return tabs.filter((s) => {
    if (!s.pid) return true
    const root = rows.find((row) => row.pid === s.pid)
    if (!root) return true
    if (engineProcessIn(rows, s.pid) || vendorFromArgv(root.args)) return true
    const [taskId, tabId] = s.key.split("::")
    const labelled = readTabsSnapshot(taskId)?.tabs.some((tab) => tab.id === tabId && tab.kind === "engine")
    if (tabId !== "tab-1" && !labelled && !sessionArgvNamesEngine(s.command)) return false
    const executable = basename(root.args.split(/\s+/)[0])
      .toLowerCase()
      .replace(/^-/, "")
      .replace(/\.exe$/, "")
    // The launch shell retains -c through init and engine startup, then execs a bare shell on exit.
    if (["sh", "bash", "zsh", "fish", "dash", "ash", "ksh", "mksh"].includes(executable)) {
      return /^\S+\s+-[a-zA-Z]*c\b/.test(root.args)
    }
    return true
  }).length
}

export async function openAdmittedEngine(
  rpc: HostedSessionRpc,
  spec: Pick<PtySpawnSpec, "cwd" | "command" | "defaultColors"> & { key: string },
  opts: { maxLiveEngines?: number; snapshot?: PsSnapshot; taskId: string; retryArgs: readonly string[] },
): Promise<PtyOpenResult> {
  const limit = opts.maxLiveEngines
  if (limit === undefined) return rpc.request("pty.open", spec)
  for (let attempt = 0; attempt < 20; attempt++) {
    const { sessions, admissionToken } = await rpc.request<{
      sessions: PtySessionInfo[]
      admissionToken?: string
    }>("pty.list", {})
    if (typeof admissionToken !== "string") {
      throw new ApiError(
        "the PTY host must be updated before enforcing engine.maxLiveSessions",
        "ENGINE_ADMISSION_UNAVAILABLE",
        {
          taskId: opts.taskId,
          hint: "the running PTY host predates atomic admission; update and restart the PTY host before retrying",
          nextCommandArgs: opts.retryArgs,
        },
      )
    }
    const live = await countLiveEngineSessions(sessions, opts.snapshot)
    // Attaching to a winner of the same-key race does not consume a slot.
    if (!sessions.some((s) => s.key === spec.key && s.alive) && live >= limit) {
      throw new ApiError(
        `${live} engine sessions are already running (engine.maxLiveSessions is ${limit})`,
        "ENGINE_LIMIT",
        {
          taskId: opts.taskId,
          live,
          limit,
          hint: "wait for an engine to finish or close a tab, then retry; raise engine.maxLiveSessions in state.json to allow more",
          nextCommandArgs: opts.retryArgs,
        },
      )
    }
    const result = await rpc.request<PtyCheckedOpenResult>("pty.openChecked", { ...spec, admissionToken })
    if (result.kind === "opened") return result.open
  }
  throw new ApiError("PTY inventory kept changing during engine admission; retry the send", "ENGINE_ADMISSION_BUSY", {
    taskId: opts.taskId,
    nextCommandArgs: opts.retryArgs,
  })
}

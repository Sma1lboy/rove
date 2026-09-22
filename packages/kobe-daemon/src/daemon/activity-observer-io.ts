/**
 * Production IO for `activity-observer.ts`: `pty.list` over the PTY host socket
 * (NEVER spawns one; unreachable → null, as `ptyHostHasLiveSessions`), the
 * process walk and title vocabulary via the runtime adapter (engine knowledge
 * stays kobe-owned), and durable death records. The loop may not open a
 * socket, read a file or write the registry; this file holds no cadence or
 * state. Imports run one way: this → the loop's contract.
 */

import { KobeDaemonClient } from "../client/index.ts"
import type { ActivityObserverIo } from "./activity-observer.ts"
import type { DaemonActivityRegistry } from "./activity-registry.ts"
import { logDaemonInfo } from "./crash-log.ts"
import { defaultPtyExitsPath, defaultPtyHostSocketPath } from "./paths.ts"
import { engineExitCodeFromTail, plainTail, readPtyExitRecords, recordEngineExit } from "./pty-exit-store.ts"
import { engineDeathOf } from "./pty-exit-watch.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"

export function createActivityObserverIo(
  homeDir: string | undefined,
  runtime: Pick<DaemonRuntimeAdapter, "foregroundEngines" | "titleTurnHint">,
  /** For the boot reconciler only: an unwatched death has no other path into
   *  the registry (`pty-exit-watch` baselines its record). Without it, no
   *  restart re-badge. */
  activity?: Pick<DaemonActivityRegistry, "recordEngineDeath">,
): ActivityObserverIo {
  const peek = async (key: string): Promise<string> => {
    const client = new KobeDaemonClient(defaultPtyHostSocketPath(homeDir))
    try {
      await client.connect()
      const result = await client.request<{ data?: string }>("pty.peek", { key })
      return Buffer.from(result.data ?? "", "base64").toString("utf8")
    } catch {
      return ""
    } finally {
      client.close()
    }
  }
  return {
    // Persist the PTY tail (where the provider error / usage-limit line is). Best-effort.
    onEngineExit({ taskId, tabId, vendor, pid }) {
      const key = `${taskId}::${tabId}`
      const pending = peek(key)
        .then((tail) =>
          recordEngineExit({ key, vendor, pid, at: new Date().toISOString(), tail }, defaultPtyExitsPath(homeDir)),
        )
        .catch((err) => logDaemonInfo("engine-exit", `record failed for ${key}: ${String(err)}`))
      logDaemonInfo("engine-exit", `${vendor} (pid ${pid ?? "?"}) gone from live session ${key}`)
      return pending
    },
    /**
     * Boot reconciliation for deaths that predate this daemon's first walk:
     *
     *   - daemon RESTARTED after the death: the record survives, but the
     *     registry is in-memory and `pty-exit-watch` baselines what's on disk,
     *     so `dead` would read `idle` while the tab is a bare login shell that
     *     EXECUTES whatever is typed. Re-publish from the record.
     *   - engine died while the daemon was DOWN (it idle-exits on its last
     *     GUI — the ordinary window): no record exists. Write one;
     *     `pty-exit-watch` badges it.
     *
     * Both require POSITIVE evidence: the wrapper's `⚠ Engine exited (code N)`
     * banner in the ring (a never-started engine looks the same otherwise).
     * keepAlive prints it only for a NONZERO exit, so clean quits stay
     * unrecorded by design.
     *
     * ponytail: one boot record per session key — a second unwatched death in
     * the same tab is suppressed by the first. Re-recording every boot would
     * republish the same corpse forever; give the record a real clock (a
     * freeze-store timestamp) if that ceiling bites.
     */
    onEngineAbsentAtStart({ taskId, tabId }) {
      const key = `${taskId}::${tabId}`
      const path = defaultPtyExitsPath(homeDir)
      const existing = readPtyExitRecords(path)[`${key}#engine`]
      if (existing) {
        const death = engineDeathOf(existing)
        // No `at` guard: the boot registry has no hook claim to bury, and the walk found no engine.
        if (death) activity?.recordEngineDeath(death.taskId, death.tabId, death.exit, death.at)
        return
      }
      return peek(key)
        .then((raw) => {
          if (engineExitCodeFromTail(plainTail(raw)) === null) return
          // The banner carries no clock, so `at` is now, flagged approximate.
          recordEngineExit({ key, pid: null, at: new Date().toISOString(), tail: raw, atApproximate: true }, path)
          logDaemonInfo("engine-exit", `recorded an unwatched death in ${key} (exit time unknown)`)
        })
        .catch((err) => logDaemonInfo("engine-exit", `boot record failed for ${key}: ${String(err)}`))
    },
    async listSessions() {
      const client = new KobeDaemonClient(defaultPtyHostSocketPath(homeDir))
      try {
        await client.connect()
        const result = await client.request<{
          sessions?: Array<{ key?: string; alive?: boolean; pid?: number | null; title?: string; totalBytes?: number }>
        }>("pty.list")
        return (result.sessions ?? []).map((s) => ({
          key: s.key ?? "",
          alive: s.alive === true,
          pid: typeof s.pid === "number" ? s.pid : null,
          title: typeof s.title === "string" ? s.title : "",
          totalBytes: typeof s.totalBytes === "number" ? s.totalBytes : 0,
        }))
      } catch {
        return null
      } finally {
        client.close()
      }
    },
    foregroundEngines: (pids) => runtime.foregroundEngines(pids),
    titleTurnHint: (vendor, title) => runtime.titleTurnHint(vendor, title),
  }
}

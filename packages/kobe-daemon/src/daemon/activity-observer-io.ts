/**
 * Production IO for the activity observer — the half that touches the world.
 *
 * `activity-observer.ts` is the pure loop: cadence, tracks, edges, and claims,
 * with every fact injected. This is the adapter that supplies those facts —
 * `pty.list` over the standalone PTY host's socket (NEVER spawns one;
 * unreachable reads as null, the same contract as `ptyHostHasLiveSessions`),
 * the process walk and title vocabulary through the runtime adapter (engine
 * knowledge stays kobe-owned), and the durable death records the loop's edges
 * turn into.
 *
 * The seam is what each half may know: the loop may not open a socket, read a
 * file, or write the registry, and this file holds no cadence or state. It
 * imports the loop's contract type and the loop imports nothing from here, so
 * the direction is one-way.
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
  /** Activity registry, for the boot reconciler alone: a death this daemon
   *  never watched happen has no path into the in-memory registry, and
   *  `pty-exit-watch` baselines the very record that would fill it. Optional
   *  — without it the observer works, minus the restart re-badge. */
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
    // The engine died inside a living PTY: grab that PTY's tail (the
    // provider error / usage-limit line lives there) and persist a record
    // the PTY-layer hook would never write. Best-effort by contract.
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
     * Boot reconciliation — the two engine deaths the vendor→null EDGE
     * structurally cannot report, because both happened before this daemon
     * ever walked the session:
     *
     *   - the daemon was RESTARTED after the death (routine: AGENTS.md tells
     *     agents to do it after editing daemon code). The durable record
     *     survives, but the activity registry is in-memory by contract and
     *     `pty-exit-watch` baselines everything already on disk, so the tab's
     *     `dead` badge came back as `idle` — byte-identical to a tab that
     *     never ran an engine, while the tab is really a bare login shell
     *     that will EXECUTE anything typed at it. Re-publish from the record.
     *   - the engine died while the daemon was DOWN (it idle-exits on its
     *     last GUI, so this is the ordinary window, not an exotic one).
     *     Nobody walked, so no record was ever written and the death was
     *     unrecoverable history — no badge, no Inbox item, nothing to find.
     *     Write one now; `pty-exit-watch` badges it from there.
     *
     * Both gate on the same POSITIVE evidence: the wrapper's own
     * `⚠ Engine exited (code N)` banner still in the session's ring. "An
     * engine tab with no engine" is not evidence — a tab whose engine was
     * never started looks identical. keepAlive prints the banner only for a
     * NONZERO exit, so a clean quit stays unrecorded, which is the store's
     * no-noise rule holding rather than a gap.
     *
     * ponytail: one boot record per session key — a second unwatched death
     * in the same tab is suppressed by the first record. Re-recording on
     * every boot instead would republish the same corpse forever; give the
     * record a real clock (a freeze-store timestamp) if that ceiling ever
     * bites.
     */
    onEngineAbsentAtStart({ taskId, tabId }) {
      const key = `${taskId}::${tabId}`
      const path = defaultPtyExitsPath(homeDir)
      const existing = readPtyExitRecords(path)[`${key}#engine`]
      if (existing) {
        const death = engineDeathOf(existing)
        // No `at` guard needed: the registry is empty at boot, so there is no
        // live hook claim this could bury — and the walk just proved there is
        // no engine in the session either.
        if (death) activity?.recordEngineDeath(death.taskId, death.tabId, death.exit, death.at)
        return
      }
      return peek(key)
        .then((raw) => {
          if (engineExitCodeFromTail(plainTail(raw)) === null) return
          // `at` is NOW, flagged approximate: the banner proves the death and
          // carries no clock, and inventing one that reads as exact is worse
          // than saying so.
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

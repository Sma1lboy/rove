/**
 * Fleet reads: one machine's capacity (`node-status`, what a center probes)
 * and the whole fleet as this machine sees it (`fleet-status`).
 */

import { ROVE_API_VERSION } from "@sma1lboy/rove-daemon/daemon/protocol"
import { readFleetConfig } from "../../fleet/config.ts"
import { electCenter, probeFleet } from "../../fleet/dispatch.ts"
import { collectNodeStatus } from "../../fleet/node-status.ts"
import { nodeLoad } from "../../fleet/schedule.ts"
import { daemonOf } from "./handler-helpers.ts"
import { engineListIds } from "./handlers-engines.ts"
import type { VerbContext, VerbSpec } from "./types.ts"

const nodeStatusOf = (ctx: VerbContext) => collectNodeStatus(daemonOf(ctx), engineListIds)

export const FLEET_VERBS: readonly VerbSpec[] = [
  {
    name: "node-status",
    group: "discover",
    summary:
      "This machine as a fleet center sees it: { hostname, version, cpus, loadAvg1, memFreeRatio, liveSessions, maxLiveSessions, tasks, engines, tags, description, repos: [{ path, remote }] }. `remote` is the normalized origin (github.com/o/r) a center matches a task's repo by. With --machine <alias> it reports that machine.",
    flags: [],
    handler: nodeStatusOf,
  },
  {
    name: "fleet-status",
    group: "discover",
    summary:
      "The fleet from this machine: `center` is who `--machine any|auto` goes to right now (`self`, a machine alias, or null when no fleet.centers candidate answers); `nodes` probes this machine (`local`) and every registered machine with its load, or `error` when it did not answer.",
    flags: [],
    async handler(ctx) {
      const config = readFleetConfig()
      const [center, probes] = await Promise.all([
        electCenter(config),
        probeFleet(async () => ({ apiVersion: ROVE_API_VERSION, ok: true, result: await nodeStatusOf(ctx) })),
      ])
      return {
        centers: config.centers,
        center: center === null ? null : center.kind === "self" ? "self" : center.entry.alias,
        nodes: probes.map((p) =>
          p.status
            ? {
                machine: p.alias,
                hostname: p.status.hostname,
                version: p.status.version,
                load: Number(nodeLoad(p.status).toFixed(2)),
                liveSessions: p.status.liveSessions,
                ...(p.status.maxLiveSessions !== undefined ? { maxLiveSessions: p.status.maxLiveSessions } : {}),
                tags: p.status.tags,
                repos: p.status.repos.length,
              }
            : { machine: p.alias, error: p.why ?? "did not answer" },
        ),
      }
    },
  },
]

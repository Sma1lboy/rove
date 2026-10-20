/**
 * Settings → Auto routing: what each depth tier launches (`autoRouting.<tier>.engine|model|effort`)
 * and who picks a tier (`autoRouting.classifier`).
 *
 * Deliberately absent: the classifier endpoint, threshold and API key. An endpoint is a
 * destination the Mac would POST prompts to and the key is a secret the Mac would store, both
 * authored by the client. `autoRouting.setClassifier` only moves between `off`, `jev` and the
 * endpoint the TUI already remembered; the get op shows that endpoint's host, never its URL.
 */

import { readClassifierConfig } from "@sma1lboy/rove/src/engine/auto-routing-classifier.ts"
import {
  AUTO_ROUTING_TIERS,
  autoRoutingKey,
  describeTierBlock,
  readAutoRoutingTable,
  tierBlock,
} from "@sma1lboy/rove/src/engine/auto-routing.ts"
import { protocolEntry } from "@sma1lboy/rove/src/engine/engine-presets.ts"
import { secretStatus } from "@sma1lboy/rove/src/state/secrets.ts"
import { displayEndpoint } from "@sma1lboy/rove/src/tui/component/settings-dialog/model.ts"
import { BridgeError } from "../protocol.ts"
import { oneOf } from "./args.ts"
import { type EngineDeps, engineIds, realDeps } from "./settings-engines.ts"
import { optModel } from "./tasks-shared.ts"
import type { OpTable } from "./types.ts"

const MODE_KEY = "autoRouting.classifier"
/** The last endpoint typed in the TUI, kept while the mode points elsewhere. */
const ENDPOINT_KEY = "autoRouting.classifierEndpoint"
const CLASSIFIER_MODES = ["off", "jev", "custom"] as const

export type RoutingDeps = EngineDeps & { readonly secret: (name: string) => "env" | "file" | "none" }

const real: RoutingDeps = { ...realDeps, secret: (name) => secretStatus(name).source }

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/** The engines the tier picker offers, with what each one accepts. */
async function pickable(deps: RoutingDeps, ids: readonly string[]) {
  return ids.map((id) => {
    const entry = protocolEntry(id)
    return {
      id,
      name: deps.engineName(id),
      effortLevels: entry.effortLevels ?? [],
      takesModel: Boolean(entry.modelArgv),
    }
  })
}

function classifierView(deps: RoutingDeps, state: Record<string, unknown>) {
  const get = (key: string) => state[key]
  const config = readClassifierConfig(get)
  const mode = config.mode.kind === "url" ? "custom" : config.mode.kind === "jev" ? "jev" : "off"
  const endpoint = displayEndpoint(config.mode.kind, str(state[MODE_KEY]), str(state[ENDPOINT_KEY]))
  let host = ""
  try {
    host = endpoint ? new URL(endpoint).host : ""
  } catch {
    host = ""
  }
  return {
    mode,
    // Host only: a URL can carry a token in its userinfo or query.
    endpointHost: host,
    canCustom:
      str(state[ENDPOINT_KEY]).length > 0 &&
      readClassifierConfig((k) => (k === MODE_KEY ? state[ENDPOINT_KEY] : state[k])).mode.kind === "url",
    threshold: config.threshold,
    keyConfigured: config.keyEnv !== undefined,
    keySource: config.keyEnv ? deps.secret(config.keyEnv) : "none",
    ...(config.keyEnv ? { keyEnv: config.keyEnv } : {}),
  }
}

export function createRoutingOps(deps: RoutingDeps): OpTable {
  return {
    "autoRouting.get": {
      kind: "read",
      destructive: false,
      wraps:
        "settings Auto routing section: readAutoRoutingTable + tierBlock over the engine statuses + readClassifierConfig",
      async run() {
        const state = deps.load()
        const ids = await engineIds(deps, state)
        const statuses = await deps.statuses(ids).catch(() => [])
        const table = readAutoRoutingTable((key) => state[key])
        const engineSet = new Set(ids)
        return {
          configured: table !== null,
          tiers: table
            ? AUTO_ROUTING_TIERS.map((tier) => {
                const target = table[tier]
                const block = tierBlock(target, {
                  engineIds: engineSet,
                  accountKind: (engine) => statuses.find((s) => s.vendor === engine)?.account?.kind ?? null,
                })
                return {
                  tier,
                  engine: target.engine,
                  engineName: deps.engineName(target.engine),
                  model: target.model ?? null,
                  effort: target.effort ?? null,
                  block: block ? describeTierBlock(block) : null,
                }
              })
            : [],
          engines: await pickable(deps, ids),
          classifier: classifierView(deps, state),
        }
      },
    },
    "autoRouting.setTier": {
      kind: "write",
      destructive: true,
      wraps: "state.json autoRouting.<tier>.engine|model|effort, as the Auto routing row's engine picker",
      async run(args) {
        const tier = oneOf(args, "tier", AUTO_ROUTING_TIERS)
        const state = deps.load()
        const engines = await pickable(deps, await engineIds(deps, state))
        const engine = engines.find((e) => e.id === args.engine)
        if (!engine) throw new BridgeError("BAD_ARGS", "engine is not a listed engine")
        const model = optModel(args, "model") ?? ""
        if (model && !engine.takesModel) throw new BridgeError("BAD_ARGS", `${engine.id} takes no model`)
        const effort = typeof args.effort === "string" ? args.effort : ""
        if (effort && !engine.effortLevels.includes(effort)) {
          throw new BridgeError("BAD_ARGS", `effort must be one of ${engine.effortLevels.join("|") || "(none)"}`)
        }
        // `""` clears a field, so a shipped default cannot leak back under an engine that never declared it.
        deps.patch({
          [autoRoutingKey(tier, "engine")]: engine.id,
          [autoRoutingKey(tier, "model")]: model,
          [autoRoutingKey(tier, "effort")]: effort,
        })
        return { tier, engine: engine.id, model: model || null, effort: effort || null }
      },
    },
    "autoRouting.setClassifier": {
      kind: "write",
      destructive: true,
      wraps: "state.json autoRouting.classifier: off | jev | the endpoint the TUI remembered (never a client-sent URL)",
      async run(args) {
        const mode = oneOf(args, "mode", CLASSIFIER_MODES)
        const state = deps.load()
        const view = classifierView(deps, state)
        // Leaving custom keeps its URL for the next pass through, as the TUI's cycle does.
        const live = str(state[MODE_KEY])
        const remember = view.mode === "custom" && live ? { [ENDPOINT_KEY]: live } : {}
        if (mode === "custom") {
          if (!view.canCustom) throw new BridgeError("BAD_ARGS", "no custom endpoint is remembered; set one in the TUI")
          deps.patch({ [MODE_KEY]: str(state[ENDPOINT_KEY]) })
        } else {
          deps.patch({ ...remember, [MODE_KEY]: mode })
        }
        return { mode }
      },
    },
  }
}

export const routingOps: OpTable = createRoutingOps(real)

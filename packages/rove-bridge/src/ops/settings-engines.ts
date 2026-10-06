/**
 * Settings → Engines for the phone: what the TUI section lists (binary, login, how the engine
 * reports) and the state.json writes behind its switches, with the section's invariants kept:
 * the last enabled engine never goes off, and the default is always an enabled engine.
 *
 * Deliberately absent: editing an engine's launch command. `engineCommand.<id>` is what the
 * daemon spawns, so a phone-authored value would be a command line the Mac runs. The phone can
 * reset it to the built-in default (`engine.reset`); changing it stays a Mac-side action.
 * Account emails and the command's arguments (users paste API keys into them) never leave the Mac.
 */

import { installedEngineIds } from "@sma1lboy/rove/src/engine/account-detect.ts"
import { type EngineStatus, detectEngineStatuses } from "@sma1lboy/rove/src/engine/engine-status.ts"
import { type EngineIntegration, engineIntegrations } from "@sma1lboy/rove/src/engine/integration-status.ts"
import { defaultEngineCommand, engineDisplayName } from "@sma1lboy/rove/src/engine/interactive-command.ts"
import { type StateSnapshot, loadStateFile, patchStateFile } from "@sma1lboy/rove/src/state/store.ts"
import { ALL_VENDORS, isBuiltinVendor } from "@sma1lboy/rove/src/types/vendor.ts"
import { BridgeError } from "../protocol.ts"
import { bool, text } from "./args.ts"
import type { Args, OpTable } from "./types.ts"

const NAME_MAX = 60

export interface EngineDeps {
  readonly load: () => StateSnapshot
  /** `undefined` values delete their key (patchStateFile's contract). */
  readonly patch: (patch: StateSnapshot) => void
  /** Contrib engines whose CLI is on PATH and plugin-registered engines. */
  readonly installed: () => Promise<readonly string[]>
  readonly statuses: (ids: readonly string[]) => Promise<readonly EngineStatus[]>
  readonly integrations: (ids: readonly string[]) => readonly EngineIntegration[]
  readonly engineName: (id: string) => string
  readonly defaultCommand: (id: string) => readonly string[]
}

const realDeps: EngineDeps = {
  load: loadStateFile,
  patch: (patch) => {
    patchStateFile(patch)
  },
  installed: installedEngineIds,
  statuses: detectEngineStatuses,
  integrations: engineIntegrations,
  engineName: engineDisplayName,
  defaultCommand: defaultEngineCommand,
}

function strings(state: StateSnapshot, key: string): string[] {
  const raw = state[key]
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : []
}

function trimmed(state: StateSnapshot, key: string): string {
  const raw = state[key]
  return typeof raw === "string" ? raw.trim() : ""
}

/** Same order as the TUI section: built-ins, the user's own, then what was detected. */
async function engineIds(deps: EngineDeps, state: StateSnapshot): Promise<string[]> {
  return [...new Set([...ALL_VENDORS, ...strings(state, "customEngineIds"), ...(await deps.installed())])]
}

/** Only a built-in or a user-added engine resolves as the default (`validVendor` in vendor-prefs). */
function canBeDefault(state: StateSnapshot, id: string): boolean {
  return isBuiltinVendor(id) || strings(state, "customEngineIds").includes(id)
}

/** The ● engine: the stored default when it is still valid and on, else the first enabled one. */
function effectiveDefault(state: StateSnapshot, ids: readonly string[]): string | null {
  const off = strings(state, "disabledEngineIds")
  const stored = trimmed(state, "defaultVendor")
  if (stored && canBeDefault(state, stored) && !off.includes(stored)) return stored
  return ids.find((id) => canBeDefault(state, id) && !off.includes(id)) ?? null
}

/** Engine id from the phone, held to ids this machine's section actually lists. */
function listedId(args: Args, ids: readonly string[]): string {
  const id = text(args, "id", 64)
  if (!ids.includes(id)) throw new BridgeError("BAD_ARGS", `${id} is not a listed engine`)
  return id
}

export function createEngineOps(deps: EngineDeps): OpTable {
  const without = (list: readonly string[], id: string): string[] => list.filter((x) => x !== id)

  /** What state.json must say after `id` stops being offered; throws if that would strand new tasks. */
  function afterLeaving(state: StateSnapshot, ids: readonly string[], id: string, off: readonly string[]) {
    const remaining = ids.filter((x) => x !== id && !off.includes(x))
    if (remaining.length === 0) throw new BridgeError("LAST_ENGINE", "this is the last enabled engine; it stays on")
    if (effectiveDefault(state, ids) !== id) return {}
    const next = remaining.find((x) => canBeDefault(state, x))
    if (!next) throw new BridgeError("LAST_ENGINE", "no other enabled engine can take over as the default")
    return { defaultVendor: next }
  }

  return {
    "engines.settings": {
      kind: "read",
      destructive: false,
      wraps: "settings Engines section: registry + detectEngineStatuses + engineIntegrations + state.json switches",
      async run() {
        const state = deps.load()
        const ids = await engineIds(deps, state)
        const [statuses, integrations] = await Promise.all([
          deps.statuses(ids).catch((): readonly EngineStatus[] => []),
          Promise.resolve(deps.integrations(ids)).catch((): readonly EngineIntegration[] => []),
        ])
        const off = strings(state, "disabledEngineIds")
        const custom = strings(state, "customEngineIds")
        const current = effectiveDefault(state, ids)
        return {
          defaultId: current,
          engines: ids.map((id) => {
            const status = statuses.find((s) => s.vendor === id)
            const integration = integrations.find((i) => i.vendor === id)
            const override = trimmed(state, `engineCommand.${id}`)
            const command = override ? override.split(/\s+/) : deps.defaultCommand(id)
            const account = status?.account
            return {
              id,
              name: deps.engineName(id),
              builtin: isBuiltinVendor(id),
              custom: custom.includes(id),
              enabled: !off.includes(id),
              isDefault: id === current,
              canBeDefault: canBeDefault(state, id),
              // The program only: arguments may carry keys.
              binary: command[0] ?? null,
              customized: override.length > 0 || trimmed(state, `engineName.${id}`).length > 0,
              protocol: trimmed(state, `engineProtocol.${id}`) || null,
              binaryFound: status ? status.binary.found : null,
              binaryPath: status?.binary.found ? (status.binary.path ?? null) : null,
              // No detector is "unknown", never "signed out".
              login:
                !status || account === null || account === undefined || status.accountError
                  ? "unknown"
                  : account.kind === "none"
                    ? "no"
                    : "yes",
              hooks: integration?.hooksSupported ? integration.hookState : "unsupported",
              markers: integration?.markers ?? false,
              screen: integration?.screen ?? false,
              ...(integration?.configIssue ? { configIssue: integration.configIssue } : {}),
            }
          }),
        }
      },
    },
    "engine.setEnabled": {
      kind: "write",
      destructive: true,
      wraps: "state.json disabledEngineIds (+ defaultVendor handoff), as Settings → Engines `space`",
      async run(args) {
        const state = deps.load()
        const ids = await engineIds(deps, state)
        const id = listedId(args, ids)
        const enabled = bool(args, "enabled")
        const off = strings(state, "disabledEngineIds")
        if (enabled) {
          deps.patch({ disabledEngineIds: without(off, id) })
        } else if (!off.includes(id)) {
          const handoff = afterLeaving(state, ids, id, off)
          deps.patch({ disabledEngineIds: [...off, id], ...handoff })
        }
        return { id, enabled }
      },
    },
    "engine.setDefault": {
      kind: "write",
      destructive: true,
      wraps: "state.json defaultVendor (+ re-enables it), as Settings → Engines `d`",
      async run(args) {
        const state = deps.load()
        const ids = await engineIds(deps, state)
        const id = listedId(args, ids)
        if (!canBeDefault(state, id)) {
          throw new BridgeError("BAD_ARGS", `${id} cannot be the default; only built-in and custom engines can`)
        }
        const off = strings(state, "disabledEngineIds")
        // A switched-off default would never be offered, so choosing it switches it back on.
        deps.patch({ defaultVendor: id, ...(off.includes(id) ? { disabledEngineIds: without(off, id) } : {}) })
        return { id }
      },
    },
    "engine.rename": {
      kind: "write",
      destructive: true,
      wraps: "state.json engineName.<id>, as Settings → Engines `r` (blank clears)",
      async run(args) {
        const state = deps.load()
        const id = listedId(args, await engineIds(deps, state))
        const raw = typeof args.name === "string" ? args.name.trim() : ""
        // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
        if (raw.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(raw)) {
          throw new BridgeError("BAD_ARGS", `name must be at most ${NAME_MAX} printable characters`)
        }
        deps.patch({ [`engineName.${id}`]: raw.length > 0 ? raw : undefined })
        return { id, name: raw.length > 0 ? raw : deps.engineName(id) }
      },
    },
    "engine.reset": {
      kind: "write",
      destructive: true,
      wraps: "state.json engineCommand/engineName/engineProtocol/customEngineIds, as Settings → Engines `x`",
      async run(args) {
        const state = deps.load()
        const ids = await engineIds(deps, state)
        const id = listedId(args, ids)
        const clear = { [`engineCommand.${id}`]: undefined, [`engineName.${id}`]: undefined }
        const custom = strings(state, "customEngineIds")
        if (!custom.includes(id)) {
          // Built-in and detected engines only ever lose their overrides.
          deps.patch(clear)
          return { id, removed: false }
        }
        const off = strings(state, "disabledEngineIds")
        const handoff = off.includes(id) ? {} : afterLeaving(state, ids, id, off)
        deps.patch({
          ...clear,
          [`engineProtocol.${id}`]: undefined,
          customEngineIds: without(custom, id),
          disabledEngineIds: without(off, id),
          ...handoff,
        })
        return { id, removed: true }
      },
    },
  }
}

export const engineOps: OpTable = createEngineOps(realDeps)

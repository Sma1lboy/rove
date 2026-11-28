/**
 * `appearance.list` / `appearance.set`: discovers appearance packs in
 * `~/.rove/appearances/`, validates their manifests, pre-checks component
 * bundles, and persists the selected pack id under `appearance.pack` in state.json.
 * Every call re-reads the directory so hard-refreshing rove-web picks up edits immediately.
 */

import {
  type AppearancePackFailure,
  type LoadedAppearancesResult,
  loadUserAppearances,
} from "@sma1lboy/rove-client/appearance/loader.ts"
import { type AppearanceManifest, validateAppearancePackId } from "@sma1lboy/rove-client/appearance/manifest.ts"
import {
  APPEARANCE_PACK_STATE_KEY,
  DEFAULT_APPEARANCE_PACK,
  normalizeAppearancePack,
} from "@sma1lboy/rove-client/appearance/slots.ts"
import { type StateSnapshot, loadStateFile, updateStateFile } from "@sma1lboy/rove-core/state/store.ts"
import { type AppearanceBundleError, bundleAppearancePack } from "../appearance-bundle.ts"
import { BridgeError } from "../protocol.ts"
import type { OpTable } from "./types.ts"

export interface AppearancePackSummary {
  readonly id: string
  readonly manifest: AppearanceManifest
  readonly fingerprint: string
  readonly hasComponents: boolean
  readonly bundleUrl: string | null
  readonly bundleError?: AppearanceBundleError
}

export interface AppearanceListReply {
  readonly dir: string
  readonly active: string
  readonly packs: readonly AppearancePackSummary[]
  readonly errors: readonly AppearancePackFailure[]
}

export interface AppearanceOpsDeps {
  readonly loadState: () => StateSnapshot
  readonly updateState: (compute: (fresh: StateSnapshot) => StateSnapshot) => void
  readonly scan: () => LoadedAppearancesResult
}

const realDeps: AppearanceOpsDeps = {
  loadState: loadStateFile,
  updateState: (compute) => {
    updateStateFile((state) => {
      for (const [key, value] of Object.entries(compute(state))) {
        if (value === undefined) delete state[key]
        else state[key] = value
      }
      return undefined
    })
  },
  scan: () => loadUserAppearances(),
}

async function listAppearances(deps: AppearanceOpsDeps): Promise<AppearanceListReply> {
  const active = normalizeAppearancePack(deps.loadState()[APPEARANCE_PACK_STATE_KEY])
  const scanned = deps.scan()
  const packs: AppearancePackSummary[] = []
  for (const pack of scanned.packs) {
    const hasComponents = pack.components.length > 0
    let bundleError: AppearanceBundleError | undefined
    if (hasComponents) {
      const built = await bundleAppearancePack(pack)
      if (!built.ok) bundleError = built.error
    }
    packs.push({
      id: pack.id,
      manifest: pack.manifest,
      fingerprint: pack.fingerprint,
      hasComponents,
      bundleUrl:
        hasComponents && !bundleError
          ? `/appearances/${encodeURIComponent(pack.id)}/bundle.js?v=${encodeURIComponent(pack.fingerprint)}`
          : null,
      ...(bundleError ? { bundleError } : {}),
    })
  }
  return {
    dir: scanned.dir,
    active,
    packs,
    errors: scanned.errors,
  }
}

export function createAppearanceOps(deps: AppearanceOpsDeps): OpTable {
  return {
    "appearance.list": {
      kind: "read",
      destructive: false,
      wraps: "read ~/.rove/appearances/ packs, validation errors, component bundle status, and active pack id",
      async run() {
        return listAppearances(deps)
      },
    },
    "appearance.set": {
      kind: "write",
      destructive: false,
      wraps: "persist appearance.pack in state.json (either 'default' or a valid pack slug)",
      async run(args) {
        const raw = args.id
        if (typeof raw !== "string" || raw.trim().length === 0) {
          throw new BridgeError("BAD_ARGS", "id must be a non-empty appearance pack name or 'default'")
        }
        const id = raw.trim()
        if (id !== DEFAULT_APPEARANCE_PACK) {
          const bad = validateAppearancePackId(id)
          if (bad) throw new BridgeError("BAD_ARGS", bad)
        }
        deps.updateState(() => ({ [APPEARANCE_PACK_STATE_KEY]: id }))
        return listAppearances(deps)
      },
    },
  }
}

export const appearanceOps: OpTable = createAppearanceOps(realDeps)

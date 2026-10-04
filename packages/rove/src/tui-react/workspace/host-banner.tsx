/** @jsxImportSource @opentui/react */
/**
 * Which banner the workspace host shows, and the daemon signals that decide
 * it. Rendered in three places. The WIRING is the fragile part, so
 * `host-version-skew-banner.test.tsx` drives it through the real `WorkspaceRoot`.
 */

import type { ColorInput } from "@opentui/core"
import type { ReactNode } from "react"
import { type SelfRefreshInputs, planSelfRefresh } from "../../cli/self-relaunch.ts"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { findBinding } from "../../tui/context/keybindings"
import { formatChord } from "../../tui/lib/chord-glyphs"
import { currentPrefixConfiguration } from "../../tui/lib/keymap-dispatch"
import { CURRENT_VERSION } from "../../version.ts"
import { StaleInstallBanner, VersionSkewBanner } from "../component/version-skew-banner"
import { useAccessor } from "../lib/use-accessor"

export interface HostBanner {
  /** The banner element — rendered by every one of the host's return paths. */
  readonly element: ReactNode
  /** What `app.refresh` should do, and whether to register it. */
  readonly refresh: {
    /** False → unregistered, so the command guide never advertises a no-op. */
    readonly available: boolean
    /** The facts `selfRefreshAction` needs, snapshotted this render. */
    readonly inputs: SelfRefreshInputs
  }
  /** Daemon-polled npm check, for the passive update chip (`u` / click opens the page). */
  readonly update: { readonly hasUpdate: boolean; readonly latest: string } | null
}

/**
 * Version skew ("new binary, stale daemon") is the ordinary result of
 * updating, since the daemon outlives `npm i -g`, and persists until a
 * restart, hence a banner. Do NOT add a disconnect banner: reconnect recovers
 * most drops in under a second, leaving nothing to act on.
 *
 * Outranking skew: this install was deleted, so no daemon can start. Latched,
 * never cleared; only a reinstall fixes it.
 */
export function useHostBanner(orch: RemoteOrchestrator, width: number): HostBanner {
  const daemonStale = useAccessor(orch.daemonStaleSignal())
  const daemonVersion = useAccessor(orch.daemonVersionSignal())
  const update = useAccessor(orch.updateSignal())
  const staleInstall = useAccessor(orch.staleInstallSignal())
  const daemonRestarting = useAccessor(orch.daemonRestartingSignal())
  const inputs: SelfRefreshInputs = {
    daemonVersion,
    clientVersion: CURRENT_VERSION,
    staleInstall,
    daemonRestarting,
  }
  const available = planSelfRefresh(inputs).kind === "refresh"
  const element = staleInstall ? (
    <StaleInstallBanner message={staleInstall} width={width} />
  ) : (
    <VersionSkewBanner
      stale={daemonStale}
      daemonVersion={daemonVersion}
      clientVersion={CURRENT_VERSION}
      refreshChord={available ? refreshChord() : null}
      width={width}
    />
  )
  return { element, update, refresh: { available, inputs } }
}

/** The live `app.refresh` chord, resolved every render so rebinds show.
 *  Null when unbound → fallback copy (`update.skew.hintNoKey`). */
function refreshChord(): string | null {
  const prefixKey = currentPrefixConfiguration().key
  const stroke = findBinding("app.refresh")?.prefixKeys?.[0]
  return prefixKey && stroke ? `${formatChord(prefixKey)} ${stroke}` : null
}

/** A whole-window page bypasses `WorkspaceFrame`, so it re-wraps the banner here. */
export function FullWindowPage(props: {
  banner: ReactNode
  background: ColorInput
  children: ReactNode
}): ReactNode {
  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={props.background}>
      {props.banner}
      {props.children}
    </box>
  )
}

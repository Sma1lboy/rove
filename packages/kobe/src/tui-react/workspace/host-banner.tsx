/** @jsxImportSource @opentui/react */
/**
 * Which banner the workspace host shows across the top of the window, and the
 * daemon signals that decide it.
 *
 * Its own module because the host renders the result in THREE places — the
 * settings page, a full-window page, and `WorkspaceFrame` all wrap it — while
 * the choice between the two banners is one question with one answer. The
 * WIRING is the fragile part — a correct banner component nobody mounts looks
 * exactly like a working one — so `host-version-skew-banner.test.tsx` drives
 * these signals through the real `WorkspaceRoot` rather than through this hook.
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
  /** What the workspace's `app.refresh` chord should do, and whether to
   *  register it at all. See {@link useHostBanner}. */
  readonly refresh: {
    /** False when there is nothing to refresh — the chord stays unregistered
     *  so the command guide never advertises a no-op. */
    readonly available: boolean
    /** The facts `selfRefreshAction` needs, snapshotted this render. */
    readonly inputs: SelfRefreshInputs
  }
  /** Daemon-polled npm check (collectors' update channel). Read here because
   *  it is the same "is this install current" family as the two banners; the
   *  chip itself is the passive half of the update surface, and `u` / a click
   *  opens the page. */
  readonly update: { readonly hasUpdate: boolean; readonly latest: string } | null
}

/**
 * What `daemonStaleSignal()` names is not an edge case: Rove ships several
 * times a day and the daemon is a long-lived process that outlives an
 * `npm i -g`, which makes "new binary, stale daemon" the ordinary result of
 * updating. It persists until someone restarts the daemon, which is why it
 * gets a banner.
 *
 * Skew only — do NOT add a daemon-disconnect banner beside it. A full-width
 * alert on every socket drop is the wrong weight: the reconnect loop recovers
 * most drops in under a second, and Rove keeps working through the ones it
 * doesn't, so the alert would interrupt to announce something with nothing to
 * act on.
 *
 * The one condition that outranks skew: this process's install was deleted, so
 * it cannot start a daemon at all. Without its own state that reads as an
 * ordinary reconnect, indefinitely. Latched, never cleared: only a reinstall
 * fixes it.
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

/**
 * The live `app.refresh` chord, as the banner should print it — resolved from
 * the keymap and the configured prefix on every render, so a rebound prefix or
 * stroke changes the banner's copy with it. Null when the row has been
 * unbound, which is what makes the fallback copy (`update.skew.hintNoKey`)
 * exist: telling a user to press a key that does nothing is worse than telling
 * them to type the two commands.
 */
function refreshChord(): string | null {
  const prefixKey = currentPrefixConfiguration().key
  const stroke = findBinding("app.refresh")?.prefixKeys?.[0]
  return prefixKey && stroke ? `${formatChord(prefixKey)} ${stroke}` : null
}

/**
 * A page that replaces the WHOLE window — Settings, or a full-window rail
 * page. Those bypass `WorkspaceFrame`, which is what normally carries the
 * banner, so they have to re-wrap it themselves; this is the one place that
 * pairing is written down instead of once per page kind.
 */
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

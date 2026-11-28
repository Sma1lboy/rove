/**
 * Fault isolation for appearance packs:
 *  - `OuterAppearanceBoundary` wraps the shell so a pack-induced crash disables
 *    the pack and re-renders the default UI instead of leaving a blank screen.
 *  - `SlotErrorBoundary` wraps each individual slot so a broken slot falls back
 *    to that slot's default Rove UI while the rest of the pack stays active.
 *  - `AppearanceErrorBanner` surfaces the exact pack, file/slot, and error with
 *    a one-click "Switch to default" action and Settings link.
 */

import type { AppearanceSlotId } from "@sma1lboy/rove-client/appearance/index.ts"
import { Component, type ErrorInfo, type ReactNode } from "react"
import type { BridgeClient } from "../bridge.ts"
import { t, useLocale } from "../i18n/index.ts"
import { AP_ERROR_ACTIONS, AP_ERROR_BADGE, AP_ERROR_BANNER, AP_ERROR_MSG } from "../ui/appearance.ts"
import { Button } from "../ui/button.tsx"
import {
  appearanceStore,
  disableAppearanceAfterCrash,
  reportSlotCrash,
  resetAppearanceToDefault,
  useAppearance,
} from "./runtime.ts"

interface OuterProps {
  readonly children: ReactNode
}

interface OuterState {
  readonly tripped: boolean
}

/** Top-level appearance safety net: if a render error occurs while a pack is active, drop the pack and recover. */
export class OuterAppearanceBoundary extends Component<OuterProps, OuterState> {
  state: OuterState = { tripped: false }

  static getDerivedStateFromError(error: Error): OuterState | null {
    const cur = appearanceStore.get()
    if (cur.activePack !== null && !cur.disabledByCrash) {
      return { tripped: true }
    }
    throw error
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const cur = appearanceStore.get()
    if (cur.activePack !== null && !cur.disabledByCrash) {
      disableAppearanceAfterCrash(error, info.componentStack ?? undefined)
      this.setState({ tripped: false })
    }
  }

  render() {
    if (this.state.tripped) return null
    return this.props.children
  }
}

interface SlotBoundaryProps {
  readonly packId: string
  readonly slot: AppearanceSlotId
  readonly file?: string
  readonly fallback: ReactNode
  readonly children: ReactNode
}

interface SlotBoundaryState {
  readonly crashed: boolean
}

/** Per-slot error boundary: a throw inside one slot falls back only that slot to default UI. */
export class SlotErrorBoundary extends Component<SlotBoundaryProps, SlotBoundaryState> {
  state: SlotBoundaryState = { crashed: false }

  static getDerivedStateFromError(): SlotBoundaryState {
    return { crashed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportSlotCrash(this.props.packId, this.props.slot, this.props.file, error, info.componentStack ?? undefined)
  }

  render() {
    if (this.state.crashed) return this.props.fallback
    return this.props.children
  }
}

/** Compact debug banner shown when the active appearance pack failed to load or crashed a slot. */
export function AppearanceErrorBanner({
  client,
  onOpenSettings,
}: {
  readonly client: BridgeClient
  readonly onOpenSettings: () => void
}) {
  useLocale()
  const state = useAppearance()
  if (state.runtimeErrors.length === 0) return null
  const latest = state.runtimeErrors[state.runtimeErrors.length - 1]
  if (!latest) return null
  const location = [latest.slot, latest.file].filter(Boolean).join(" · ")
  return (
    <div className={AP_ERROR_BANNER} role="alert" data-appearance-error-banner>
      <span className={AP_ERROR_BADGE}>{t("settings.appearance.packErrorBadge")}</span>
      <span className="font-semibold text-ink">{latest.packId}</span>
      {location && <span className="text-muted">{location}</span>}
      <span className={AP_ERROR_MSG} title={latest.message}>
        {latest.message}
      </span>
      <div className={AP_ERROR_ACTIONS}>
        <Button variant="link" onClick={onOpenSettings}>
          {t("settings.appearance.packErrorDetails")}
        </Button>
        <Button variant="action" onClick={() => void resetAppearanceToDefault(client)}>
          {t("settings.appearance.packSwitchDefault")}
        </Button>
      </div>
    </div>
  )
}

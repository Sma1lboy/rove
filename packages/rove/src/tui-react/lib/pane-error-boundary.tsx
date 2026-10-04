/** @jsxImportSource @opentui/react */
/**
 * Render-error containment. The host root keeps one boundary as the last
 * line of defence; each Workspace Host region (sidebar, workspace, files,
 * full-window page) gets its own, so one region throwing leaves the others
 * live instead of blanking the whole window.
 */

import { logClientError } from "@sma1lboy/rove-daemon/client/client-log"
import { Component, type ErrorInfo, type ReactNode } from "react"
import { recentStateChangesForDiagnostics } from "../../lib/external-store"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

export type PaneRegion = "sidebar" | "workspace" | "files" | "page"

export interface PaneErrorBoundaryProps {
  readonly children?: ReactNode
  /** Omitted at the host root. Names the region in the fallback and the log. */
  readonly region?: PaneRegion
  /** A change in any entry clears a caught error, e.g. selecting another task. */
  readonly resetKeys?: readonly unknown[]
  /** Fixed width of the region the fallback stands in for; omitted = grow. */
  readonly width?: number
}

function PaneCrashFallback(props: { region?: PaneRegion; width?: number; onRetry: () => void }) {
  const { theme } = useTheme()
  const t = useT()
  const sizing = props.width === undefined ? { flexGrow: 1 } : { width: props.width, flexShrink: 0 }
  return (
    <box {...sizing} flexDirection="column" backgroundColor={theme.background} paddingLeft={1} paddingTop={1} gap={1}>
      <text fg={theme.error} wrapMode="word">
        {props.region
          ? t("common.paneCrash.regionTitle", { region: t(`common.paneCrash.region.${props.region}`) })
          : t("common.paneCrash.title")}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {t(props.region ? "common.paneCrash.regionHint" : "common.paneCrash.hint")}
      </text>
      <text fg={theme.focusAccent} onMouseUp={props.onRetry}>
        {t("common.paneCrash.retry")}
      </text>
    </box>
  )
}

/** Error stack + component stack + recent state transitions (shapes/counts only). */
function formatPaneCrashDiagnostic(region: PaneRegion | undefined, error: unknown, info: ErrorInfo): string {
  const base = error instanceof Error ? (error.stack ?? error.message) : String(error)
  const componentStack = info.componentStack?.trim() || "(unavailable)"
  const stateChanges = recentStateChangesForDiagnostics()
  return `region: ${region ?? "root"}\n${base}\nReact component stack:\n${componentStack}\nRecent state changes:\n${
    stateChanges.length > 0 ? stateChanges.join("\n") : "(none recorded)"
  }`
}

function sameKeys(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((value, i) => Object.is(value, b[i]))
}

/** Render errors only; fire-and-forget rejections go to `installClientCrashHandlers`. */
export class PaneErrorBoundary extends Component<PaneErrorBoundaryProps, { error: unknown | null }> {
  override state: { error: unknown | null } = { error: null }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  // Logging lives here: the only callback with the component stack.
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    logClientError("pane-crash", formatPaneCrashDiagnostic(this.props.region, error, info))
  }
  override componentDidUpdate(prev: PaneErrorBoundaryProps): void {
    if (this.state.error !== null && !sameKeys(prev.resetKeys, this.props.resetKeys)) this.setState({ error: null })
  }
  private readonly retry = (): void => this.setState({ error: null })
  override render() {
    if (this.state.error !== null)
      return <PaneCrashFallback region={this.props.region} width={this.props.width} onRetry={this.retry} />
    return this.props.children
  }
}

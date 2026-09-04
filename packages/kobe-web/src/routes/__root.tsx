import { createRootRoute, Outlet } from "@tanstack/react-router"
import { ErrorBoundary } from "../components/ErrorBoundary.tsx"

import "../styles.css"

export const Route = createRootRoute({
  component: RootComponent,
})

/**
 * The root of the capture app. `/harness` is the only route: it embeds
 * xterm.js over the PTY sidecar and runs the REAL OpenTUI, which is the one
 * ground-truth surface for visual acceptance (docs/HARNESS.md).
 *
 * There is deliberately nothing else here — no global shortcuts, no command
 * palette, no document-title badge. Those belonged to the browser dashboard
 * this app used to be; a capture surface that reacts to keystrokes of its own
 * would compete with the TUI it is photographing.
 */
function RootComponent() {
  return (
    <ErrorBoundary>
      <Outlet />
    </ErrorBoundary>
  )
}

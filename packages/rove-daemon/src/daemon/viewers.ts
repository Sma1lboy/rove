/**
 * Who is looking: the UI environment behind each `ui.viewing` report, as `rove api viewers`
 * tells an agent. The optional `ui.viewing` fields are what a client alone knows (`panel`,
 * `panelOpen`, `narrow`) plus what the bridge decides per connection (`surface`, `local`); a
 * client that omits them still registers, as a TUI or an unknown remote screen.
 */

export type ViewerSurface = "tui" | "web" | "phone"

/** What one `ui.viewing` report says about the screen. */
export interface ViewerInfo {
  readonly surface: ViewerSurface
  /** Has a side panel (Files / Diff / Browser): web desktop only. */
  readonly panel: boolean
  readonly panelOpen?: boolean
  readonly narrow?: boolean
  /** Same machine as the daemon: its `localhost` is the agent's `localhost`. */
  readonly local: boolean
}

/** One attached screen, as `viewers` lists it. */
export interface Viewer extends ViewerInfo {
  readonly viewer: string
  readonly taskId: string
  readonly tabId?: string
}

const SURFACES: readonly string[] = ["tui", "web", "phone"]

/**
 * Read the optional fields of a `ui.viewing` payload. A TUI (no `viewer` name) is local and has
 * no panel; an old bridge that names a viewer but sends no `surface` is a remote web screen.
 */
export function parseViewerInfo(payload: Record<string, unknown>, viewer: string): ViewerInfo {
  const surface =
    typeof payload.surface === "string" && SURFACES.includes(payload.surface)
      ? (payload.surface as ViewerSurface)
      : viewer === ""
        ? "tui"
        : "web"
  const flag = (key: string) => (typeof payload[key] === "boolean" ? (payload[key] as boolean) : undefined)
  const panelOpen = flag("panelOpen")
  const narrow = flag("narrow")
  return {
    surface,
    panel: surface === "web" && flag("panel") === true,
    ...(panelOpen !== undefined ? { panelOpen } : {}),
    ...(narrow !== undefined ? { narrow } : {}),
    local: flag("local") ?? surface === "tui",
  }
}

/** @jsxImportSource @opentui/react */
/**
 * Shared boot sequence for kobe's pane hosts. Boot order: log context →
 * crash handlers → keybindings.yaml overlay → user themes → prefs read →
 * per-host setup → provider-wrapped render, with the framework-free pieces
 * (`applyUserKeybindings`, `loadUserThemes`, `readPersistedUiPrefs`,
 * `applyUiPrefs`, `hostRenderOptions`, `installPaneExitBackstop`) imported
 * from the shared modules.
 *
 *   - Visual prefs are seeded into the module-level theme store BEFORE
 *     `createRoot().render()`, so the first painted frame is already styled
 *     and no component needs render-time side effects.
 *   - The live daemon subscription rides the client layer's framework-free
 *     store twins (`uiPrefsStore()` / `keybindingsRevStore()`), which notify
 *     outside any component.
 *   - The error boundary is a small class component (React's only boundary
 *     primitive), with crash logging + a themed fallback.
 *   - Provider flags: `kv` defaults to FALSE — every pane opts in
 *     explicitly, so mounting KV implicitly would silently change them.
 */

import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import {
  installClientCrashHandlers,
  logClientError,
  setClientLogContext,
} from "@sma1lboy/kobe-daemon/client/client-log"
import type { UiPrefsPayload } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { Component, type ErrorInfo, type ReactNode, useEffect } from "react"
import { connectPaneOrchestrator } from "../../client/connect-pane-orchestrator"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { recentStateChangesForDiagnostics } from "../../lib/external-store"
import { applyUserKeybindings, reloadUserKeybindings } from "../../tui/context/keybindings-user"
import { loadUserThemes } from "../../tui/context/theme/loader"
import { type UiPrefsTarget, applyUiPrefs } from "../../tui/lib/apply-ui-prefs"
import { installEventLoopStallTelemetry } from "../../tui/lib/event-loop-stall"
import {
  hostRenderOptions,
  inlineRenderOptions,
  installBracketedPasteMode,
  installExitRestoreBackstop,
  installOrphanExitWatchdog,
  installPaneExitBackstop,
} from "../../tui/lib/host-render-options"
import { createHostImeOutput } from "../../tui/lib/ime-anchor-output"
import { type PersistedUiPrefs, readPersistedUiPrefs } from "../../tui/lib/persisted-ui-prefs"
import { installScreenSelfHeal } from "../../tui/lib/screen-refresh"
import { FocusProvider } from "../context/focus"
import { KVProvider } from "../context/kv"
import { NotificationsProvider } from "../context/notifications"
import {
  ThemeProvider,
  addTheme,
  focusAccent,
  hasTheme,
  selectedTheme,
  setFocusAccent,
  setTheme,
  setTransparentBackground,
  transparentBackground,
} from "../context/theme"
import { DEFAULT_THEME, useTheme } from "../context/theme"
import { isLocaleId, setLocaleLang, t } from "../i18n"
import { DialogProvider } from "../ui/dialog"

/** Theme used when `state.json` is missing/stale — kobe's brand default. */
const FALLBACK_THEME = DEFAULT_THEME

/** Provider flags; see the header for the defaults. */
interface HostProviderFlags {
  /** KVProvider (persisted UI state). Default false — see header. */
  readonly kv?: boolean
  /** FocusProvider, initial pane "sidebar". Default true. */
  readonly focus?: boolean
  /** NotificationsProvider (toast queue). Default false. */
  readonly notifications?: boolean
}

/** What a host's `setup` hands back once its own pre-render work is done. */
interface HostScreen {
  /** The host's root view, rendered inside the provider stack. */
  readonly root: () => ReactNode
  /** Teardown on ACTUAL exit (renderer destroy), never at mount-resolve. */
  readonly onDestroy?: () => void
}

export interface BootPaneHostOpts {
  readonly logContext?: string
  readonly providers?: HostProviderFlags
  /**
   * Render ink-style in an N-row footer on the main screen instead of the
   * fullscreen alternate screen. For CLI-command hosts (`kobe update list`)
   * — the shell's scrollback stays visible above the page.
   */
  readonly inlineRows?: number
  readonly setup: (prefs: PersistedUiPrefs) => HostScreen | Promise<HostScreen>
}

/** The module-level theme store as a ui-prefs target (shared applyUiPrefs). */
const themeTarget: UiPrefsTarget = {
  selectedTheme,
  hasTheme,
  setTheme,
  reloadUserThemes: () => {
    for (const { name, theme } of loadUserThemes()) addTheme(name, theme)
  },
  transparentBackground,
  setTransparentBackground,
  focusAccent,
  setFocusAccent,
}

/**
 * Live ui-prefs + keybindings subscription — boot values were already
 * seeded before render (see `bootPaneHost`), so this component only owns
 * the daemon channel. Channel-scoped, non-spawning, degrades to boot-time
 * prefs with no daemon; late connects after unmount are disposed on the
 * spot. The first keybindings rev observed is the boot replay — skipped.
 */
function UiPrefsSync() {
  useEffect(() => {
    let disposed = false
    let orch: RemoteOrchestrator | null = null
    const disposers: Array<() => void> = []
    void (async () => {
      const remote = await connectPaneOrchestrator({
        logTag: "ui-prefs",
        channels: ["ui-prefs", "keybindings"],
      })
      if (!remote) return
      if (disposed) {
        remote.dispose()
        return
      }
      orch = remote
      // Framework-free store twins of the client layer's values — they notify
      // outside any component. Deliver the current value eagerly (the
      // subscribe-time channel replay may have landed before we attached).
      const applyPrefs = (payload: UiPrefsPayload | null) => {
        if (!payload) return
        applyUiPrefs(themeTarget, payload)
        if (isLocaleId(payload.locale)) setLocaleLang(payload.locale)
      }
      const prefsStore = remote.uiPrefsStore()
      applyPrefs(prefsStore.get())
      disposers.push(prefsStore.subscribe(() => applyPrefs(prefsStore.get())))

      const revStore = remote.keybindingsRevStore()
      // The first observed rev is the boot replay — already applied by
      // applyUserKeybindings in bootPaneHost; only later bumps are edits.
      let lastKeybindingsRev: number | null = revStore.get()
      disposers.push(
        revStore.subscribe(() => {
          const rev = revStore.get()
          if (rev == null || rev === lastKeybindingsRev) return
          const isFirst = lastKeybindingsRev === null
          lastKeybindingsRev = rev
          if (!isFirst) reloadUserKeybindings()
        }),
      )
    })()
    return () => {
      disposed = true
      for (const dispose of disposers) dispose()
      orch?.dispose()
    }
  }, [])
  return null
}

/** Themed crash fallback. Logging belongs to componentDidCatch below because
 *  that is the only React boundary callback carrying the component stack. */
function PaneCrashFallback() {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.background} paddingLeft={1} paddingTop={1} gap={1}>
      <text fg={theme.error}>{t("common.paneCrash.title")}</text>
      <text fg={theme.textMuted}>{t("common.paneCrash.hint")}</text>
    </box>
  )
}

/** Preserve the ordinary error stack, then add React ownership and the last
 *  bounded state transitions. State summaries contain shapes/counts only. */
function formatPaneCrashDiagnostic(error: unknown, info: ErrorInfo): string {
  const base = error instanceof Error ? (error.stack ?? error.message) : String(error)
  const componentStack = info.componentStack?.trim() || "(unavailable)"
  const stateChanges = recentStateChangesForDiagnostics()
  return `${base}\nReact component stack:\n${componentStack}\nRecent state changes:\n${
    stateChanges.length > 0 ? stateChanges.join("\n") : "(none recorded)"
  }`
}

/**
 * React's boundary primitive is still a class component. Catches render
 * errors from the host's view tree; fire-and-forget rejections are covered
 * by `installClientCrashHandlers`.
 */
export class PaneErrorBoundary extends Component<{ children?: ReactNode }, { error: unknown | null }> {
  override state: { error: unknown | null } = { error: null }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    logClientError("pane-crash", formatPaneCrashDiagnostic(error, info))
  }
  override render() {
    if (this.state.error !== null) return <PaneCrashFallback />
    return this.props.children
  }
}

/**
 * Boot a standalone React pane host: shared steps → prefs read + seed →
 * per-host `setup` → provider-wrapped `createRoot().render()`. Resolves
 * once the root is mounted.
 */
export async function bootPaneHost(opts: BootPaneHostOpts): Promise<void> {
  if (opts.logContext) setClientLogContext(opts.logContext)
  installClientCrashHandlers()
  applyUserKeybindings()
  for (const { name, theme } of loadUserThemes()) addTheme(name, theme)

  // Validate against the registry we just populated, not the bundled set —
  // a `kobe theme add` theme is a legitimate persisted choice.
  const prefs = readPersistedUiPrefs(FALLBACK_THEME, hasTheme)
  // Seed ALL visual prefs + language before the first render — the module
  // store is live before any component mounts, so the first frame is
  // already themed (no transparent/accent flash).
  applyUiPrefs(themeTarget, {
    theme: prefs.theme,
    transparentBackground: prefs.transparent,
    focusAccent: prefs.focusAccent,
  })
  setLocaleLang(prefs.locale)

  const kv = opts.providers?.kv ?? false
  const focus = opts.providers?.focus ?? true
  const notifications = opts.providers?.notifications ?? false

  const screen = await opts.setup(prefs)
  const imeOutput = createHostImeOutput({
    platform: process.platform,
    fullscreen: opts.inlineRows === undefined,
    stdout: process.stdout,
  })
  let detachImeOutput = (): void => {}
  const onDestroy = (): void => {
    detachImeOutput()
    imeOutput.flush()
    screen.onDestroy?.()
  }
  const renderer = await createCliRenderer({
    ...(opts.inlineRows !== undefined ? inlineRenderOptions(opts.inlineRows, onDestroy) : hostRenderOptions(onDestroy)),
    ...imeOutput.rendererOptions,
  })
  detachImeOutput = imeOutput.attach(renderer)
  // OpenTUI never forces a full repaint after a resize in alternate-screen
  // mode, so on Windows the reflowed leftovers of the old geometry survive
  // every later diffed frame. No-op off win32 — see `screen-refresh.ts`.
  // Never detached: it lives exactly as long as the renderer.
  installScreenSelfHeal({ renderer })

  const body = (
    <>
      <UiPrefsSync />
      <PaneErrorBoundary>{screen.root()}</PaneErrorBoundary>
    </>
  )
  // Fixed nesting order: Theme > KV > Focus > Dialog > Notifications; only
  // membership varies.
  const withNotifications = notifications ? <NotificationsProvider>{body}</NotificationsProvider> : body
  const withDialog = <DialogProvider>{withNotifications}</DialogProvider>
  const withFocus = focus ? <FocusProvider initial="sidebar">{withDialog}</FocusProvider> : withDialog
  const withKv = kv ? <KVProvider>{withFocus}</KVProvider> : withFocus
  createRoot(renderer).render(
    <ThemeProvider mode="dark" theme={prefs.theme}>
      {withKv}
    </ThemeProvider>,
  )
  installExitRestoreBackstop(renderer)
  // After render: opentui has finished its own terminal setup, so the mode we
  // add on top isn't clobbered by it.
  installBracketedPasteMode()
  installPaneExitBackstop()
  installOrphanExitWatchdog()
  installEventLoopStallTelemetry()
}

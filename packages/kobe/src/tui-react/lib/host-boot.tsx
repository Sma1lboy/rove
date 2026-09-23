/** @jsxImportSource @opentui/react */
/**
 * Shared boot for pane hosts: log context → crash handlers →
 * keybindings.yaml overlay → user themes → prefs read → per-host setup →
 * provider-wrapped render.
 *
 *   - Visual prefs are seeded into the theme store BEFORE render, so the
 *     first frame is styled.
 *   - `kv` defaults to FALSE: panes opt in explicitly, so mounting KV
 *     implicitly would silently change them.
 */

import { profileMark, profileTick, renderProfileOn } from "@/lib/render-profile"
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
import { KvWriteErrorToasts } from "../context/kv-write-error-toasts"
import { NotificationsProvider } from "../context/notifications"
import {
  ThemeProvider,
  addTheme,
  focusAccent,
  hasTheme,
  selectedTheme,
  setFocusAccent,
  setTheme,
  setThemeMode,
  setTransparentBackground,
  themeMode,
  transparentBackground,
} from "../context/theme"
import { DEFAULT_THEME, useTheme } from "../context/theme"
import { isLocaleId, setLocaleLang, t } from "../i18n"
import { DialogProvider } from "../ui/dialog"
import { RenderProfiler } from "./render-profiler"

/** Theme used when `state.json` is missing/stale. */
const FALLBACK_THEME = DEFAULT_THEME

interface HostProviderFlags {
  /** KVProvider. Default false — see header. */
  readonly kv?: boolean
  /** FocusProvider, initial pane "sidebar". Default true. */
  readonly focus?: boolean
  /** NotificationsProvider. Default false. */
  readonly notifications?: boolean
}

interface HostScreen {
  readonly root: () => ReactNode
  /** Teardown on ACTUAL exit (renderer destroy), never at mount-resolve. */
  readonly onDestroy?: () => void
}

export interface BootPaneHostOpts {
  readonly logContext?: string
  readonly providers?: HostProviderFlags
  /** Render in an N-row main-screen footer, not the alternate screen, so shell scrollback stays visible. */
  readonly inlineRows?: number
  readonly setup: (prefs: PersistedUiPrefs) => HostScreen | Promise<HostScreen>
}

/** The module-level theme store as an `applyUiPrefs` target. */
const themeTarget: UiPrefsTarget = {
  selectedTheme,
  hasTheme,
  setTheme,
  reloadUserThemes: () => {
    for (const { name, theme } of loadUserThemes()) addTheme(name, theme)
  },
  themeMode,
  setThemeMode,
  transparentBackground,
  setTransparentBackground,
  focusAccent,
  setFocusAccent,
}

/**
 * Live daemon ui-prefs + keybindings (boot values were seeded before render).
 * Non-spawning: with no daemon, boot-time prefs stand. A connect landing
 * after unmount is disposed on the spot.
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
      // Apply the current value eagerly: the channel replay may have landed
      // before we attached.
      const applyPrefs = (payload: UiPrefsPayload | null) => {
        if (!payload) return
        applyUiPrefs(themeTarget, payload)
        if (isLocaleId(payload.locale)) setLocaleLang(payload.locale)
      }
      const prefsStore = remote.uiPrefsStore()
      applyPrefs(prefsStore.get())
      disposers.push(prefsStore.subscribe(() => applyPrefs(prefsStore.get())))

      const revStore = remote.keybindingsRevStore()
      // The first rev is the boot replay, already applied by applyUserKeybindings.
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

/** Logging lives in componentDidCatch: the only callback with the component stack. */
function PaneCrashFallback() {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.background} paddingLeft={1} paddingTop={1} gap={1}>
      <text fg={theme.error}>{t("common.paneCrash.title")}</text>
      <text fg={theme.textMuted}>{t("common.paneCrash.hint")}</text>
    </box>
  )
}

/** Error stack + component stack + recent state transitions (shapes/counts only). */
function formatPaneCrashDiagnostic(error: unknown, info: ErrorInfo): string {
  const base = error instanceof Error ? (error.stack ?? error.message) : String(error)
  const componentStack = info.componentStack?.trim() || "(unavailable)"
  const stateChanges = recentStateChangesForDiagnostics()
  return `${base}\nReact component stack:\n${componentStack}\nRecent state changes:\n${
    stateChanges.length > 0 ? stateChanges.join("\n") : "(none recorded)"
  }`
}

/** Render errors only; fire-and-forget rejections go to `installClientCrashHandlers`. */
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

/** Resolves once the root is mounted. */
export async function bootPaneHost(opts: BootPaneHostOpts): Promise<void> {
  if (opts.logContext) setClientLogContext(opts.logContext)
  installClientCrashHandlers()
  applyUserKeybindings()
  for (const { name, theme } of loadUserThemes()) addTheme(name, theme)

  // Validate against the just-populated registry: `kobe theme add` themes count.
  const prefs = readPersistedUiPrefs(FALLBACK_THEME, hasTheme)
  // Seed before render so the first frame has no transparent/accent flash.
  applyUiPrefs(themeTarget, {
    theme: prefs.theme,
    themeMode: prefs.themeMode,
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
  // OpenTUI never fully repaints after a resize in alternate-screen mode, so
  // on Windows stale geometry survives every diffed frame. No-op off win32;
  // lives as long as the renderer.
  installScreenSelfHeal({ renderer })
  if (renderProfileOn) {
    renderer.setFrameCallback(async () => {
      profileMark("firstFrame")
      profileTick("frame")
    })
    // Listeners one resize wakes, this counter's own included.
    renderer.on("resize", () => profileTick("resizeListener", renderer.listenerCount("resize")))
  }

  const body = (
    <>
      <UiPrefsSync />
      <KvWriteErrorToasts />
      <PaneErrorBoundary>
        <RenderProfiler id="root">{screen.root()}</RenderProfiler>
      </PaneErrorBoundary>
    </>
  )
  // Fixed order Theme > KV > Focus > Dialog > Notifications; only membership varies.
  const withNotifications = notifications ? <NotificationsProvider>{body}</NotificationsProvider> : body
  const withDialog = <DialogProvider>{withNotifications}</DialogProvider>
  const withFocus = focus ? <FocusProvider initial="sidebar">{withDialog}</FocusProvider> : withDialog
  const withKv = kv ? <KVProvider>{withFocus}</KVProvider> : withFocus
  createRoot(renderer).render(<ThemeProvider theme={prefs.theme}>{withKv}</ThemeProvider>)
  installExitRestoreBackstop(renderer)
  // After render, so opentui's own terminal setup doesn't clobber it.
  installBracketedPasteMode()
  installPaneExitBackstop()
  installOrphanExitWatchdog()
  installEventLoopStallTelemetry()
}

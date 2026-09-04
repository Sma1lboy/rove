/**
 * Construction options + the handle `startDaemonServer` returns.
 *
 * Their own module so a caller can describe the server it wants without
 * importing the server — these are the options `startDaemonServer` accepts and
 * the handle it returns, no behavior. Both interfaces are re-exported from
 * `daemon/server`, so every existing import path keeps working.
 */

import type { DaemonClientConnection } from "./client-connection.ts"
import type { UpdateInfo } from "./contracts.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"

export interface DaemonServerOptions {
  /** Product/runtime behavior injected by the Rove composition root. */
  readonly runtime: DaemonRuntimeAdapter
  readonly socketPath?: string
  readonly pidPath?: string
  readonly homeDir?: string
  readonly startedAt?: Date
  readonly onStop?: () => void | Promise<void>
  /** Override the npm version check (tests inject a fake to avoid the network). */
  readonly checkUpdate?: () => Promise<UpdateInfo | null>
  /** Re-check interval in ms; `0` disables the poller. Defaults to 6h. */
  readonly updatePollMs?: number
  /** Auto-title re-scan interval in ms; `0` disables. Defaults to `DEFAULT_AUTO_TITLE_POLL_MS`. */
  readonly autoTitlePollMs?: number
  /** PR-status (`gh pr view`) poll interval in ms; `0` disables. Defaults to `DEFAULT_PR_STATUS_POLL_MS`. */
  readonly prStatusPollMs?: number
  /** UI-prefs watcher debounce in ms; `0` disables. Defaults to `DEFAULT_UI_PREFS_DEBOUNCE_MS`. */
  readonly uiPrefsDebounceMs?: number
  /** Keybindings watcher debounce in ms; `0` disables. Defaults to `DEFAULT_KEYBINDINGS_DEBOUNCE_MS`. */
  readonly keybindingsDebounceMs?: number
  /** Worktree-changes collector tick in ms; `0` disables. Defaults to `DEFAULT_WORKTREE_CHANGES_TICK_MS`. */
  readonly worktreeChangesTickMs?: number
  /** Transcript-activity collector tick in ms; `0` disables. Defaults to `DEFAULT_TRANSCRIPT_ACTIVITY_TICK_MS`. */
  readonly transcriptActivityTickMs?: number
  /** Enable the plugin runtime; `binPath` becomes plugins' ROVE_BIN_PATH plus its legacy alias. */
  readonly plugins?: { readonly binPath: string }
  /** Socket-ownership watch interval in ms; `0` disables the periodic check. */
  readonly socketWatchMs?: number
}

export interface DaemonServer {
  readonly socketPath: string
  readonly pidPath: string
  readonly startedAt: Date
  readonly clients: ReadonlySet<DaemonClientConnection>
  close(): Promise<void>
}

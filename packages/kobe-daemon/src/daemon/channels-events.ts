/**
 * Payloads for the daemon's EVENT channels — the ones that carry a request
 * or a happening rather than a state snapshot.
 *
 * The seam against `channels.ts`: that file is the channel REGISTRY (which
 * channels exist, and the state each one's last-value replay caches). These
 * are the request bodies the event channels carry — `tab.open` asks a TUI to
 * open a pane, `ui.prompt` asks a human for a line of text, `notice.event`
 * asks every attached UI for a toast. A consumer dedupes each on its `at`
 * rather than rendering it as current state, which is exactly why they do
 * not belong in the registry's state-channel narrative.
 *
 * Re-exported through `protocol.ts` like everything else here — the public
 * import path is unchanged.
 */

/** The `notice.event` channel payload — one toast for every attached UI. */
export interface NoticeEventPayload {
  readonly title: string
  /** Optional second line under the title — context, not a second message. */
  readonly body?: string
  /**
   * Free-form kind tag. The TUI styles the known severities
   * ("done" / "needs_input" / "error" — its NotificationKind vocabulary)
   * and renders anything else neutrally, so agents may invent their own.
   */
  readonly kind: string
  /** Optional task the notice concerns (drives the sidebar unread mark). */
  readonly taskId?: string
  /** Publish time (ms epoch) — the consumer-side dedupe key. */
  readonly at: number
  /** Free-form origin tag (e.g. "api", an agent name). */
  readonly source?: string
}

/** The `session.deliver` channel payload — one "paste this into task X". */
export interface SessionDeliverPayload {
  readonly taskId: string
  readonly text: string
  /** Exact terminal tab to deliver into (`dispatch --tab`); absent = the
   *  canonical engine tab. */
  readonly tabId?: string
  /** Publish time (ms epoch) — the consumer-side dedupe key. */
  readonly at: number
  readonly source: "note" | "dispatcher"
}

/** The `engine.lifecycle` channel payload — one low-frequency agent-lifecycle signal. */
export interface EngineLifecyclePayload {
  readonly taskId: string
  readonly kind: "pre-compact" | "post-compact" | "subagent-start" | "subagent-stop"
  readonly tabId?: string
  /** Publish time (ms epoch) — the consumer-side dedupe key. */
  readonly at: number
}

/** The `tab.open` channel payload — one "open a terminal pane running argv". */
export interface TabOpenPayload {
  readonly taskId: string
  /** Argv the pane's PTY spawns verbatim (no shell wrap on this side). */
  readonly argv: readonly string[]
  readonly title: string
  /** Host tab for the split (`pane-open --tab`); absent = the focused tab. */
  readonly tabId?: string
  /** `split` (default) joins the focused Terminal Tab's split group; `tab` opens a separate tab. */
  readonly placement?: "split" | "tab"
  /** Split orientation: `right` (default) lays the new pane beside the
   *  active leaf, `down` stacks it below. Ignored for `placement: "tab"`. */
  readonly direction?: "right" | "down"
  /** Publish time (ms epoch) — the consumer-side dedupe key. */
  readonly at: number
}

/** The `tab.close` channel's pane-close variant. */
export interface PaneClosePayload {
  readonly taskId: string
  /** Pane label to close — matches the `title` split leaves / command tabs
   *  were opened with (`tab.open`); engine leaves are never closed. */
  readonly title: string
  /** Scope the title match to one tab (`pane-close --tab`); absent = all
   *  tabs of the task. */
  readonly tabId?: string
  /** Publish time (ms epoch) — the consumer-side dedupe key. */
  readonly at: number
}

/** The `tab.close` channel's exact Terminal Tab close variant. */
export interface TerminalTabClosePayload {
  readonly kind: "terminal-tab"
  readonly taskId: string
  readonly tabId: string
  /** Correlates the TUI's close result with the waiting CLI request. */
  readonly requestId: string
  readonly at: number
}

/** Pane closes retain their existing wire shape; exact tab closes discriminate by `kind`. */
export type TabClosePayload = PaneClosePayload | TerminalTabClosePayload

/** The `tab.rename` channel payload — one "name this Terminal Tab". */
export interface TabRenamePayload {
  readonly taskId: string
  readonly tabId: string
  /** The new user title. Empty clears back to the tab's default name — the
   *  same meaning f2's rename dialog gives a blank field. */
  readonly title: string
  /** Publish time (ms epoch) — the consumer-side dedupe key. */
  readonly at: number
}

/** The `ui.prompt` channel payload — one host-dialog text-input request. */
export interface UiPromptPayload {
  /** Broker key the answering `ui.promptReply` names. */
  readonly promptId: string
  /** Dialog title (plugin-provided, shown verbatim). */
  readonly title: string
  readonly placeholder?: string
  /** Pre-filled input value. */
  readonly initial?: string
  /** Publish time (ms epoch) — the consumer-side dedupe key. */
  readonly at: number
}

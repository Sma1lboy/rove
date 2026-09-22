/**
 * Payloads for the daemon's EVENT channels (a request or a happening, not a
 * state snapshot); `channels.ts` is the registry and state replay. Consumers
 * dedupe each on its `at` rather than render it as current state.
 * Re-exported through `protocol.ts`.
 */

/** The `notice.event` channel payload — one toast for every attached UI. */
export interface NoticeEventPayload {
  readonly title: string
  /** Optional second line under the title — context, not a second message. */
  readonly body?: string
  /** Free-form tag. The TUI styles "done" / "needs_input" / "error" and renders anything else neutrally. */
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

/**
 * A cell's pixel size as the emulator reports it, sent by a GUI with its
 * `subscribe` (nothing, never a guess, if the terminal won't answer). Lets
 * `graphics.write` tell a caller how many cells a picture covers.
 */
export interface CellPixelSize {
  readonly width: number
  readonly height: number
}

/**
 * The `graphics.write` channel payload — opaque bytes every attached GUI writes
 * to its own tty verbatim. Rove allocates only the {@link imageId} (the id
 * space belongs to the terminal, not any one pane) and never parses the rest.
 */
export interface GraphicsWritePayload {
  readonly taskId: string
  /** The Terminal Tab whose cells the picture is meant for. */
  readonly tabId: string
  /** Daemon-allocated id the payload's own bytes already reference. */
  readonly imageId: number
  /** The payload itself, base64 over the JSON wire. Never inspected. */
  readonly data: string
  /** Publish time (ms epoch) — the consumer-side dedupe key. */
  readonly at: number
}

/**
 * Bridge server contract (`BridgeDeps`) and per-connection state (`Conn`).
 * Split from `server.ts` so the WebSocket transport loop stays focused on routing.
 */

import type { ApiEnvelope, ApiParams } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { ModPaneView } from "@sma1lboy/rove-daemon/plugins/mod-tree"
import type { AccessVerifier } from "./cf-access.ts"
import type { CredentialSockets } from "./credential-sockets.ts"
import type { DispatchFeed } from "./dispatch-feed.ts"
import type { TaskFeed } from "./feed.ts"
import type { NoticeFeed } from "./notices.ts"
import type { BridgeApi, OpTable } from "./ops/types.ts"
import type { PanelFeed } from "./panels.ts"
import type { Peer } from "./peer.ts"
import type { PromptFeed } from "./prompts.ts"
import type { Credential, PushHub } from "./push.ts"
import type { RoveOps } from "./rove-ops.ts"
import type { RowStatusFeed } from "./row-status.ts"
import type { SignIn } from "./sign-in.ts"
import type { TabFeed } from "./tab-feed.ts"
import type { PtyHostClient, TerminalForwarder } from "./terminal.ts"
import type { TranscriptFeed } from "./transcript-feed.ts"
import type { WebLogin } from "./web-login.ts"
import type { WebRoot } from "./web-static.ts"

export interface BridgeDeps {
  readonly token: string
  /** A per-device token's owner (`auth.ts` devices), or null; absent = only the shared token works. */
  readonly deviceOf?: (presented: string | null) => string | null
  /** `phone.pair`: mints a device token and returns the relay link that carries it (`run.ts`). */
  readonly pairPhone?: () => { link: string; device: string; server: string }
  /** Live sockets per credential, so a sign-out ends the connection it holds. */
  readonly sockets?: CredentialSockets
  readonly ops: RoveOps
  readonly feed: Pick<TaskFeed, "current" | "refresh" | "subscribe">
  /** `rove api notify` toasts, pushed to every connected phone as a `notice` event. */
  readonly notices?: Pick<NoticeFeed, "subscribe">
  /** Plugin input dialogs (`rove api prompt`), pushed to every connected client as a `prompt` event. */
  readonly prompts?: Pick<PromptFeed, "subscribe">
  /** `rove api panel-show` requests, pushed to every connected browser as a `panel` event. */
  readonly panels?: Pick<PanelFeed, "subscribe">
  /** Open mod panes (`mod.ui`), pushed as a `mods` event on connect and on every change. */
  readonly mods?: {
    current(): readonly ModPaneView[]
    subscribe(listener: (panes: readonly ModPaneView[]) => void): () => void
  }
  /** The daemon's dispatch ledger, pushed as a `dispatch` event on connect and on every change. */
  readonly dispatches?: Pick<DispatchFeed, "current" | "subscribe">
  /** Tasks whose Terminal Tabs changed, pushed as a `tabs` event to task subscribers. */
  readonly tabs?: Pick<TabFeed, "subscribe">
  /** Live incremental transcript updates, pushed as `transcript.update` to subscribed Chat views. */
  readonly transcripts?: Pick<TranscriptFeed, "subscribe" | "poke">
  /** The daemon's row status: where `ui.viewing` and answered questions (`term.input`) are reported. */
  readonly rowStatus?: Pick<RowStatusFeed, "setViewing" | "noteInput">
  /** A fresh PTY Host socket for one phone connection. */
  readonly openPty: () => PtyHostClient
  /** The PTY host of a registered machine, over its forwarded socket; absent = this bridge serves no machines. */
  readonly openMachinePty?: (alias: string) => Promise<PtyHostClient>
  readonly roveVersion: string
  /** Cloudflare Access check, run before the token check (`--preset cf`). */
  readonly access?: AccessVerifier
  /** Rejection and destructive-op audit log; never receives the token or the JWT. */
  readonly log?: (line: string) => void
  /** One verb or RPC per call, for area ops. */
  readonly api: BridgeApi
  /** The `api.invoke` op: any verb `api.invoke` serves, run in this process or
   *  on the registered machine `machine` names (or whose task it targets). */
  readonly invoke?: (verb: string, params: ApiParams, machine?: string) => Promise<ApiEnvelope>
  /** Area op allowlist; defaults to `AREA_OPS` (tests inject their own). */
  readonly areaOps?: OpTable
  /** Serve the browser client's files on plain GETs (`rove --web`). */
  readonly web?: WebRoot
  /** `/login` and `/logout` for the browser client (`web-login.ts`). */
  readonly login?: WebLogin
  readonly signIn?: SignIn // how a browser gets in; absent when no browser client is served
  /** The tunnel hostname (`--public-host`): a browser whose Origin is `https://<it>` is this page. */
  readonly publicHost?: string | null
  /** Web Push for closed pages (`push.ts`); absent = the `push.*` ops refuse. */
  readonly push?: Pick<PushHub, "publicKey" | "subscribe" | "unsubscribe" | "subscribed" | "setVisible">
  /** The relay ingress only (`--preset relay`): the relay agent dials this listener with no headers, so the token rides `?token=` inside the E2E tunnel. */
  readonly tokenInQuery?: boolean
}

export interface Conn {
  /** What opened it: browser or phone, on the bridge's own machine or not (decided at upgrade). */
  readonly peer: Peer
  /** This connection's screen as the daemon's row status knows it (`ui.viewing`'s `viewer`). */
  readonly viewer: string
  /** Who opened it, for the audit lines: the paired device's name (or the shared token) and its address. */
  readonly who: string
  /** The token this connection presented: a device's name, or the shared token's hash (`push.ts`). */
  readonly credential: Credential
  terminal: TerminalForwarder | null
  /** One forwarder per other machine whose terminal this connection opened. */
  machineTerminals: Map<string, Promise<TerminalForwarder>>
  /** Which forwarder owns each attached stream, so input/resize/detach reach the right machine. */
  streamOwner: Map<string, TerminalForwarder>
  unsubscribeTasks: (() => void) | null
  unsubscribeTabs: (() => void) | null
  unsubscribeNotices: (() => void) | null
  unsubscribeMods: (() => void) | null
  unsubscribePrompts: (() => void) | null
  unsubscribeDispatches: (() => void) | null
  unsubscribePanels: (() => void) | null
  /** Active `transcript.subscribe` unsubscribers keyed by `taskId::tab`. */
  transcriptSubs: Map<string, () => void>
}

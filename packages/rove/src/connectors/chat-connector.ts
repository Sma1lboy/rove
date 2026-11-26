/**
 * The contract a chat connector (a messaging app people use to talk to Rove)
 * implements. Rove only knows this shape: the daemon starts every registered
 * connector after it is listening, stops them on shutdown, and stays up while
 * any connector asks to. Protocol, credentials and command handling live in the
 * connector's own package (the WeChat one speaks Tencent's iLink Bot API).
 */

export interface ChatConnectorContext {
  /** The daemon's own socket; a connector drives Rove through `rove api` verbs on it. */
  readonly socketPath: string
  /** Structured daemon-log sink. Never pass credentials. */
  log(event: string, message: string): void
  /** Call when {@link ChatConnector.keepAlive} turns false, so the daemon may idle-stop. */
  keepAliveChanged(): void
}

export interface ChatConnector {
  start(ctx: ChatConnectorContext): Promise<void>
  stop(): void
  /** True while the connector must keep answering with no TUI attached (e.g. it is bound). */
  keepAlive(): boolean
}

/** What Settings → Connectors shows for a connector. */
export interface ChatConnectorStatus {
  readonly connected: boolean
  /** ISO time the account was connected. */
  readonly since?: string
}

/** What a connector package exports as its entry. */
export interface ChatConnectorModule {
  /** Top-level CLI word: `rove <id> …`. */
  readonly id: string
  createConnector(): ChatConnector
  /** Read from disk, so it answers without the daemon. */
  status(): ChatConnectorStatus
  /** `rove <id> <argv…>`; argv excludes the id. */
  runCli(argv: readonly string[]): Promise<void>
}

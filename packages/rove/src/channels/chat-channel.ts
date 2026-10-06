/**
 * The contract a chat channel (a messaging app people use to talk to Rove)
 * implements. Rove only knows this shape: the daemon starts every registered
 * channel after it is listening, stops them on shutdown, and stays up while
 * any channel asks to. Protocol, credentials and command handling live in the
 * channel's own package (the WeChat one speaks Tencent's iLink Bot API).
 */

export interface ChatChannelContext {
  /** The daemon's own socket; a channel drives Rove through `rove api` verbs on it. */
  readonly socketPath: string
  /** Structured daemon-log sink. Never pass credentials. */
  log(event: string, message: string): void
  /** Call when {@link ChatChannel.keepAlive} turns false, so the daemon may idle-stop. */
  keepAliveChanged(): void
}

export interface ChatChannel {
  start(ctx: ChatChannelContext): Promise<void>
  stop(): void
  /** True while the channel must keep answering with no TUI attached (e.g. it is bound). */
  keepAlive(): boolean
}

/** What a channel package exports as its entry. */
export interface ChatChannelModule {
  /** Top-level CLI word: `rove <id> …`. */
  readonly id: string
  createChannel(): ChatChannel
  /** `rove <id> <argv…>`; argv excludes the id. */
  runCli(argv: readonly string[]): Promise<void>
}

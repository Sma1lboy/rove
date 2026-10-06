/**
 * The chat channels this build ships. The single place Rove names a channel
 * package, and only by its public entry. Loaded lazily (like
 * `index-commands.ts`), so a plain `rove add` never pays for a channel.
 */

import type { ChatChannel, ChatChannelContext, ChatChannelModule } from "./chat-channel.ts"

const CHANNEL_LOADERS: Readonly<Record<string, () => Promise<ChatChannelModule>>> = {
  weixin: async () => (await import("rove-weixin")).default,
}

/** `rove <id> …` for a registered channel. */
export async function runChannelCli(id: string, argv: readonly string[]): Promise<void> {
  const load = CHANNEL_LOADERS[id]
  if (!load) throw new Error(`no chat channel "${id}"`)
  await (await load()).runCli(argv)
}

/**
 * Start every channel inside the daemon. A channel that fails to load or start
 * is logged and skipped: it must never take the daemon down with it.
 */
export async function startChatChannels(ctx: ChatChannelContext): Promise<readonly ChatChannel[]> {
  const started: ChatChannel[] = []
  for (const [id, load] of Object.entries(CHANNEL_LOADERS)) {
    try {
      const channel = (await load()).createChannel()
      await channel.start(ctx)
      started.push(channel)
    } catch (err) {
      ctx.log("channel", `${id} did not start: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return started
}

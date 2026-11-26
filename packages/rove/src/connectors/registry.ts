/**
 * The chat connectors this build ships. The single place Rove names a connector
 * package, and only by its public entry. Loaded lazily (like
 * `index-commands.ts`), so a plain `rove add` never pays for a connector.
 */

import type { ChatConnector, ChatConnectorContext, ChatConnectorModule, ChatConnectorStatus } from "./chat-connector.ts"

const CONNECTOR_LOADERS: Readonly<Record<string, () => Promise<ChatConnectorModule>>> = {
  weixin: async () => (await import("rove-weixin")).default,
  lark: async () => (await import("rove-lark")).default,
}

/** `rove <id> …` for a registered connector. */
export async function runConnectorCli(id: string, argv: readonly string[]): Promise<void> {
  const load = CONNECTOR_LOADERS[id]
  if (!load) throw new Error(`no chat connector "${id}"`)
  await (await load()).runCli(argv)
}

/**
 * Start every connector inside the daemon. A connector that fails to load or start
 * is logged and skipped: it must never take the daemon down with it.
 */
export async function startChatConnectors(ctx: ChatConnectorContext): Promise<readonly ChatConnector[]> {
  const started: ChatConnector[] = []
  for (const [id, load] of Object.entries(CONNECTOR_LOADERS)) {
    try {
      const connector = (await load()).createConnector()
      await connector.start(ctx)
      started.push(connector)
    } catch (err) {
      ctx.log("connector", `${id} did not start: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return started
}

/** Every connector this build ships, connected or not. */
export function chatConnectorStatuses(): Promise<readonly ({ readonly id: string } & ChatConnectorStatus)[]> {
  return Promise.all(Object.entries(CONNECTOR_LOADERS).map(async ([id, load]) => ({ id, ...(await load()).status() })))
}

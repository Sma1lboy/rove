/**
 * The Lark bridge as a Rove chat connector: while a binding exists, keep one
 * `lark-cli event consume im.message.receive_v1` running and feed its lines to
 * the bridge. lark-cli owns the connection to Lark and the app's credentials.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createInterface } from "node:readline"
import { setTimeout as delay } from "node:timers/promises"
import type { ChatConnector, ChatConnectorContext } from "@sma1lboy/rove-core/connectors/chat-connector.ts"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { createLarkBridge } from "./bridge.ts"
import { LARK_CLI, react } from "./lark-cli.ts"
import { createLarkOps } from "./ops.ts"
import { LarkStore } from "./store.ts"

/** How often the binding is re-read, and how long a consume that exited waits before restarting. */
const RECHECK_MS = 5_000

export function createLarkConnector(): ChatConnector {
  const store = new LarkStore()
  let child: ChildProcess | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let bound = store.readConfig() !== null
  let restartAt = 0

  return {
    async start(ctx: ChatConnectorContext) {
      const client = new RoveDaemonClient(ctx.socketPath)
      try {
        await client.connect()
      } catch (err) {
        ctx.log("lark", `could not reach the daemon socket: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      const log = (message: string) => ctx.log("lark", message)
      const bridge = createLarkBridge({
        ops: createLarkOps(client),
        store,
        react: (id, emoji) =>
          react(id, emoji).then((res) => !res.ok && log(`${emoji} reaction failed: ${res.stderr.split("\n")[0]}`)),
        log,
        sleep: (ms) => delay(ms, undefined, { ref: false }),
        now: Date.now,
      })

      const consume = () => {
        mkdirSync(store.dir, { recursive: true, mode: 0o700 })
        // stdin stays an open pipe: an unbounded consume exits on stdin EOF.
        const p = spawn(LARK_CLI, ["event", "consume", "im.message.receive_v1", "--as", "bot"], {
          stdio: ["pipe", "pipe", "pipe"],
        })
        child = p
        createInterface({ input: p.stdout }).on("line", (line) => void bridge.onLine(line))
        createInterface({ input: p.stderr }).on("line", (line) => line.trim() && log(line.slice(0, 300)))
        p.on("error", (err) => log(`lark-cli did not start: ${err.message}`))
        p.on("exit", (code) => {
          if (child === p) child = null
          restartAt = Date.now() + RECHECK_MS
          log(`consume exited (${code})`)
        })
        log("listening")
      }

      const tick = () => {
        const now = store.readConfig() !== null
        if (now !== bound) {
          bound = now
          ctx.keepAliveChanged()
        }
        // Never SIGKILL it: that leaks lark-cli's event subscription.
        if (!now && child) child.kill("SIGTERM")
        if (now && !child && Date.now() >= restartAt) consume()
      }
      tick()
      timer = setInterval(tick, RECHECK_MS)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
      child?.kill("SIGTERM")
    },
    keepAlive: () => bound,
  }
}

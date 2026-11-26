/**
 * Connecting Lark: lark-cli needs an app, a working bot and a signed-in user (the owner). The CLI runs the
 * interactive lark-cli steps in its terminal; Settings connects only when none is needed.
 */

import { spawnSync } from "node:child_process"
import type { ChatConnectOutcome } from "@sma1lboy/rove/src/connectors/chat-connector.ts"
import { LARK_CLI, authStatus, botInfo } from "./lark-cli.ts"
import { DEFAULT_TONE, type LarkConfig, type LarkStore } from "./store.ts"

export interface ConnectOptions {
  /** Run lark-cli's own setup and login in this terminal when they are missing. */
  readonly interactive: boolean
  readonly brand?: string
  readonly say?: (line: string) => void
}

const run = (args: readonly string[]): boolean => spawnSync(LARK_CLI, [...args], { stdio: "inherit" }).status === 0

export async function connectLark(
  store: LarkStore,
  opts: ConnectOptions,
): Promise<ChatConnectOutcome & { config?: LarkConfig }> {
  const say = opts.say ?? (() => {})
  const terminal = { ok: false as const, message: "rove lark connect" }
  if (spawnSync(LARK_CLI, ["--version"], { stdio: "ignore" }).error) {
    return { ok: false, message: "npm i -g @larksuite/cli && rove lark connect" }
  }
  if (!(await authStatus()).appId) {
    if (!opts.interactive) return terminal
    say("No Lark app yet: lark-cli will create one in your browser.")
    if (!run(["config", "init", "--new", ...(opts.brand ? ["--brand", opts.brand] : [])])) {
      return { ok: false, message: "lark-cli config init did not finish" }
    }
  }
  const bot = await botInfo()
  if (!bot) return { ok: false, message: `${LARK_CLI} api GET /open-apis/bot/v3/info --as bot` }
  let owner = await authStatus()
  if (!owner.userOpenId) {
    if (!opts.interactive) return terminal
    say("Sign in to Lark as yourself, so the bot knows who you are.")
    if (!run(["auth", "login", "--scope", "auth:user.id:read"])) {
      return { ok: false, message: "lark-cli auth login did not finish" }
    }
    owner = await authStatus()
  }
  const previous = store.readConfig()
  const config: LarkConfig = {
    botOpenId: bot.openId,
    botName: bot.name,
    ...(owner.userOpenId ? { ownerOpenId: owner.userOpenId } : {}),
    ...(owner.userName ? { ownerName: owner.userName } : {}),
    allow: (previous?.allow ?? []).filter((id) => id !== owner.userOpenId),
    tone: previous?.tone ?? DEFAULT_TONE,
    savedAt: previous?.savedAt || new Date().toISOString(),
  }
  store.writeConfig(config)
  return { ok: true, config }
}

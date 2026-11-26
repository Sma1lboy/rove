/**
 * `rove lark <connect|disconnect|status|allow|deny|tone>` — bind a Lark (飞书)
 * bot to this Rove. The daemon does the listening (connector.ts); these
 * commands edit the binding on disk, which the daemon re-reads.
 */

import { spawnSync } from "node:child_process"
import { SUBCOMMAND_VERBS } from "@sma1lboy/rove/src/cli/subcommands.ts"
import { ROVE_PRODUCT_NAME } from "@sma1lboy/rove/src/product.ts"
import { LARK_CLI, authStatus, botInfo } from "./lark-cli.ts"
import { DEFAULT_TONE, type LarkConfig, LarkStore } from "./store.ts"

const CLI_NAME = ROVE_PRODUCT_NAME

const LARK_USAGE = [
  `Usage: ${CLI_NAME} lark <connect|disconnect|status|allow|deny|tone>`,
  "",
  "Talk to your own Rove agent from Lark (飞书): DM the bot or @ it in a group. The agent",
  "answers in the thread and starts Rove tasks for real work. The daemon must be running.",
  "Lark is reached through lark-cli (npm i -g @larksuite/cli), which keeps the app's credentials.",
  "",
  "Commands:",
  "  connect [--brand feishu|lark]  Set up lark-cli's app if there is none (opens the browser),",
  "                      check its bot, and let you (lark-cli's signed-in user) talk to it",
  "  disconnect          Stop listening; the agent's project and the lark-cli app stay",
  "  status              The bot, allowed senders and tone",
  "  allow <open_id>     Let another person talk to the agent (ids: the daemon log's refusals)",
  "  deny <open_id>      Revoke a person added with allow",
  `  tone [text]         How the agent sounds; no text resets it to "${DEFAULT_TONE}"`,
  "",
].join("\n")

function fail(message: string): never {
  process.stderr.write(`${CLI_NAME} lark: ${message}\n`)
  process.exit(1)
}

/** Run lark-cli in this terminal: its setup and login are interactive (a browser link, a QR code). */
function interactive(args: readonly string[]): boolean {
  return spawnSync(LARK_CLI, [...args], { stdio: "inherit" }).status === 0
}

function hasLarkCli(): boolean {
  return !spawnSync(LARK_CLI, ["--version"], { stdio: "ignore" }).error
}

async function connect(store: LarkStore, argv: readonly string[]): Promise<void> {
  if (!hasLarkCli()) fail("lark-cli is not installed. Install it with: npm i -g @larksuite/cli")
  if (!(await authStatus()).appId) {
    process.stdout.write("No Lark app yet: lark-cli will create one in your browser.\n")
    const brand = argv[argv.indexOf("--brand") + 1]
    const brandArgs = argv.includes("--brand") && brand ? ["--brand", brand] : []
    if (!interactive(["config", "init", "--new", ...brandArgs])) fail("lark-cli config init did not finish")
  }
  const bot = await botInfo()
  if (!bot) fail(`the app's bot is not ready. Check it with: ${LARK_CLI} api GET /open-apis/bot/v3/info --as bot`)
  let owner = await authStatus()
  if (!owner.userOpenId) {
    process.stdout.write("Sign in to Lark as yourself, so the bot knows who you are.\n")
    if (!interactive(["auth", "login", "--scope", "auth:user.id:read"])) fail("lark-cli auth login did not finish")
    owner = await authStatus()
  }
  const previous = store.readConfig()
  const allow = [...new Set([...(owner.userOpenId ? [owner.userOpenId] : []), ...(previous?.allow ?? [])])]
  const config: LarkConfig = {
    botOpenId: bot.openId,
    botName: bot.name,
    allow,
    tone: previous?.tone ?? DEFAULT_TONE,
    savedAt: previous?.savedAt || new Date().toISOString(),
  }
  store.writeConfig(config)
  process.stdout.write(
    [
      `Lark connected: bot "${bot.name || bot.openId}".`,
      allow.length > 0
        ? `Allowed: ${owner.userName ? `${owner.userName} (${owner.userOpenId}), ` : ""}${allow.length} in all.`
        : `Nobody is allowed yet: ${CLI_NAME} lark allow <open_id>.`,
      "DM the bot or @ it in a group; your agent shows up as Lark at the bottom of the sidebar.",
      "",
    ].join("\n"),
  )
}

function status(store: LarkStore): void {
  const config = store.readConfig()
  if (!config) {
    process.stdout.write(`Lark: not connected. Run ${CLI_NAME} lark connect.\n`)
    return
  }
  const { agent } = store.readState()
  process.stdout.write(
    [
      `Lark: connected since ${config.savedAt.slice(0, 10)} as bot "${config.botName || config.botOpenId}"`,
      `Allowed: ${config.allow.join(", ") || "nobody"}`,
      `Tone: ${config.tone}`,
      `Agent: ${agent ? `${agent.taskId} ${agent.tab}` : "not started (the first message starts it)"}`,
      "",
    ].join("\n"),
  )
}

export async function runLarkCli(argv: readonly string[]): Promise<void> {
  const [verb, ...rest] = argv
  if (!verb || verb === "--help" || verb === "-h" || verb === "help") {
    process.stdout.write(`${LARK_USAGE}\n`)
    return
  }
  if (!SUBCOMMAND_VERBS.lark.includes(verb)) {
    process.stderr.write(`${CLI_NAME} lark: unknown verb "${verb}"\n\n${LARK_USAGE}\n`)
    process.exit(2)
  }
  const store = new LarkStore()
  if (verb === "connect") return await connect(store, rest)
  if (verb === "status") return status(store)
  if (verb === "disconnect") {
    process.stdout.write(store.clearConfig() ? "Lark disconnected.\n" : "Lark was not connected.\n")
    return
  }
  const config = store.readConfig() ?? fail(`not connected. Run ${CLI_NAME} lark connect first.`)
  if (verb === "tone") {
    const tone = rest.join(" ").trim() || DEFAULT_TONE
    store.writeConfig({ ...config, tone })
    process.stdout.write(`Tone: ${tone}\n`)
    return
  }
  const id = rest[0]?.trim()
  if (!id) fail(`${verb} needs an open_id`)
  const allow = verb === "allow" ? [...new Set([...config.allow, id])] : config.allow.filter((a) => a !== id)
  store.writeConfig({ ...config, allow })
  process.stdout.write(`Allowed: ${allow.join(", ") || "nobody"}\n`)
}

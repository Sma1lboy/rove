/**
 * `rove weixin <login|logout|status|allow|deny>` — bind a WeChat (微信) bot to
 * this Rove. The daemon does the talking (bridge.ts); this command only edits
 * the binding on disk, which the daemon re-reads every cycle.
 */
import { setTimeout as delay } from "node:timers/promises"
import { connectIfRunning } from "@sma1lboy/rove-daemon/client/daemon-process"
import { SUBCOMMAND_VERBS } from "@sma1lboy/rove/src/cli/subcommands.ts"
import { ROVE_PRODUCT_NAME } from "@sma1lboy/rove/src/product.ts"
import qrcode from "qrcode-terminal"
import { REPLY_WINDOW_MS } from "./bridge.ts"
import { resolveIlinkBaseUrl } from "./ilink.ts"
import { runQrLogin } from "./login.ts"
import { WeixinStore } from "./store.ts"

const CLI_NAME = ROVE_PRODUCT_NAME

const WEIXIN_USAGE = [
  `Usage: ${CLI_NAME} weixin <login|logout|status|allow|deny>`,
  "",
  "Talk to Rove from WeChat (微信): ask for status, message a task's agent,",
  "start a task, and get pinged when a task needs you. The daemon must be",
  "running for messages to flow.",
  "",
  "Commands:",
  "  login               Show a QR code; scan it in WeChat to bind (re-run to re-bind)",
  "  logout              Remove the binding and its credentials",
  "  status              Binding, allowed senders, reply windows, undelivered pushes",
  "  allow <user-id>     Let another WeChat user command Rove (ids: see status)",
  "  deny <user-id>      Revoke a user added with allow",
  "",
].join("\n")

function usageError(message: string): never {
  process.stderr.write(`${CLI_NAME} weixin: ${message}\n\n${WEIXIN_USAGE}\n`)
  process.exit(2)
}

function fail(message: string): never {
  process.stderr.write(`${CLI_NAME} weixin: ${message}\n`)
  process.exit(1)
}

function age(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

export async function runWeixinCli(argv: readonly string[]): Promise<void> {
  const [verb, arg] = argv
  if (!verb || verb === "--help" || verb === "-h" || verb === "help") {
    process.stdout.write(`${WEIXIN_USAGE}\n`)
    return
  }
  // Shared with `completions`, so a verb missing there fails loud here.
  if (!SUBCOMMAND_VERBS.weixin.includes(verb)) usageError(`unknown verb "${verb}"`)
  const store = new WeixinStore()
  switch (verb) {
    case "login":
      return await login(store)
    case "logout":
      process.stdout.write(store.clearAccount() ? "WeChat binding removed.\n" : "No WeChat binding to remove.\n")
      return
    case "status":
      return await status(store)
    case "allow":
    case "deny":
      return editAllow(store, verb, arg)
    default:
      usageError(`"${verb}" has no handler`)
  }
}

async function login(store: WeixinStore): Promise<void> {
  const result = await runQrLogin(store, resolveIlinkBaseUrl(), {
    showQr: (url) => {
      qrcode.generate(url, { small: true }, (art) => process.stdout.write(`${art}\n`))
      process.stdout.write(`Or open: ${url}\n`)
    },
    say: (line) => process.stdout.write(`${line}\n`),
    sleep: (ms) => delay(ms),
    now: Date.now,
  }).catch((err: unknown) => fail(`login failed: ${err instanceof Error ? err.message : String(err)}`))
  if (!result.ok) fail(`login failed: ${result.reason}`)
  process.stdout.write(
    [
      "Bound. Send the bot `help` from WeChat to try it.",
      `Credentials: ${store.accountPath} (owner-only)`,
      (await daemonRunning())
        ? "The running daemon picks this up within seconds."
        : `The daemon is not running — start it with \`${CLI_NAME} daemon start\`.`,
      "",
    ].join("\n"),
  )
}

async function daemonRunning(): Promise<boolean> {
  const client = await connectIfRunning().catch(() => null)
  client?.close()
  return client !== null
}

async function status(store: WeixinStore): Promise<void> {
  const account = store.readAccount()
  if (!account) {
    process.stdout.write(`Not bound. Run \`${CLI_NAME} weixin login\`.\n`)
    return
  }
  const state = store.readState(account.accountId)
  const now = Date.now()
  const lines = [
    `Bound to bot ${account.accountId} since ${account.savedAt || "unknown"}`,
    `Daemon: ${(await daemonRunning()) ? "running" : `not running — \`${CLI_NAME} daemon start\``}`,
    `Owner: ${account.ownerUserId || "(unknown — re-run login)"}`,
    `Allowed: ${account.allow.length > 0 ? account.allow.join(", ") : "owner only"}`,
  ]
  const peers = Object.entries(state.peers)
  if (peers.length > 0) {
    lines.push("Reply windows:")
    for (const [id, peer] of peers)
      lines.push(
        `  ${id}  last message ${age(now - peer.lastInboundAt)} — ${now - peer.lastInboundAt <= REPLY_WINDOW_MS ? "open" : "closed"}`,
      )
  }
  if (state.rejected.length > 0) {
    lines.push(`Refused senders (\`${CLI_NAME} weixin allow <id>\` to let one in):`)
    for (const r of state.rejected) lines.push(`  ${r.userId}  ${age(now - r.at)}`)
  }
  const undelivered = store.readUndelivered()
  if (undelivered.length > 0) {
    const last = undelivered[undelivered.length - 1]
    lines.push(`Undelivered pushes: ${undelivered.length} (${store.undeliveredPath})`)
    if (last) lines.push(`  latest ${last.at}: ${last.reason}`)
  }
  process.stdout.write(`${lines.join("\n")}\n`)
}

function editAllow(store: WeixinStore, verb: "allow" | "deny", userId: string | undefined): void {
  if (!userId) usageError(`${verb} needs a WeChat user id (see \`${CLI_NAME} weixin status\`)`)
  const account = store.readAccount()
  if (!account) fail(`not bound — run \`${CLI_NAME} weixin login\` first`)
  const allow =
    verb === "allow" ? [...new Set([...account.allow, userId])] : account.allow.filter((id) => id !== userId)
  store.writeAccount({ ...account, allow })
  process.stdout.write(
    verb === "allow"
      ? `Allowed ${userId}.\n`
      : allow.length === account.allow.length
        ? `${userId} was not on the list.\n`
        : `Removed ${userId}.\n`,
  )
}

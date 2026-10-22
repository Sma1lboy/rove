/**
 * `rove weixin <login|logout|status|allow|deny|send|agent>` — bind a WeChat
 * (微信) bot to this Rove. The daemon does the talking (bridge.ts); these
 * commands edit the binding on disk, which the daemon re-reads every cycle.
 * `send` is the exception: it pushes one message itself, so a script or
 * agent can reach the owner without going through the daemon.
 */
import { readFileSync } from "node:fs"
import { setTimeout as delay } from "node:timers/promises"
import { connectIfRunning } from "@sma1lboy/rove-daemon/client/daemon-process"
import { SUBCOMMAND_VERBS } from "@sma1lboy/rove/src/cli/subcommands.ts"
import { ROVE_PRODUCT_NAME } from "@sma1lboy/rove/src/product.ts"
import qrcode from "qrcode-terminal"
import { REPLY_WINDOW_MS } from "./bridge.ts"
import { ILINK_BASE_URL, IlinkClient, resolveIlinkBaseUrl } from "./ilink.ts"
import { runQrLogin } from "./login.ts"
import { sendBubbles } from "./send.ts"
import { WeixinStore } from "./store.ts"

const CLI_NAME = ROVE_PRODUCT_NAME

const WEIXIN_USAGE = [
  `Usage: ${CLI_NAME} weixin <login|logout|status|allow|deny|send|agent>`,
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
  "  send [text]         Message the owner (routines, scripts, agents). Text from the",
  "                      arguments, --file <path>, or stdin; --subject <line> prepends a header",
  "  agent [<task-id> [tab-N]]  Send plain (non-command) messages to this task's engine tab;",
  "                      no argument shows the binding, `agent off` removes it",
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
    case "send":
      return await send(store, argv.slice(1))
    case "agent":
      return await bindAgent(store, argv.slice(1))
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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString("utf8")
}

/** `send [--subject S] [--file F | -] [text…]` → the owner, within the reply window. */
async function send(store: WeixinStore, args: readonly string[]): Promise<void> {
  let subject: string | undefined
  let file: string | undefined
  const words: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ""
    if (a === "--subject" || a === "-s") subject = args[++i]
    else if (a === "--file" || a === "-f") file = args[++i]
    else words.push(a)
  }
  if ((subject === undefined && args.includes("--subject")) || (file === undefined && args.includes("--file")))
    usageError("--subject and --file need a value")
  if (file !== undefined && words.length > 0) usageError("pass the text or --file, not both")
  const body = (
    file === "-" || (file === undefined && words.length === 0)
      ? await readStdin()
      : file !== undefined
        ? readFileSync(file, "utf8")
        : words.join(" ")
  ).trim()
  if (!body && !subject) usageError("nothing to send")
  const text = subject ? (body ? `${subject}\n${body}` : subject) : body

  const account = store.readAccount()
  if (!account) fail(`not bound — run \`${CLI_NAME} weixin login\` first`)
  const to = account.ownerUserId
  if (!to) fail(`the binding has no owner id — re-run \`${CLI_NAME} weixin login\``)
  const peer = store.readState(account.accountId).peers[to]
  const now = Date.now()
  if (!peer || now - peer.lastInboundAt > REPLY_WINDOW_MS) {
    const reason = peer ? "reply window closed (>24h since their last message)" : "no message from the owner yet"
    store.appendUndelivered({ at: new Date(now).toISOString(), to, reason, text })
    fail(`not sent: ${reason}. WeChat only lets the bot write within a day of your last message to it.`)
  }
  const client = new IlinkClient(account.baseUrl || ILINK_BASE_URL, account.token)
  const result = await sendBubbles(client, to, text, peer.contextToken ?? null, (ms) => delay(ms))
  if (!result.ok) {
    store.appendUndelivered({ at: new Date().toISOString(), to, reason: result.reason, text: result.rest })
    fail(`not sent: ${result.reason}`)
  }
  process.stdout.write("Sent.\n")
}

/** `agent` shows, `agent off` clears, `agent <task-id> [tab-N]` binds. */
async function bindAgent(store: WeixinStore, args: readonly string[]): Promise<void> {
  const account = store.readAccount()
  if (!account) fail(`not bound — run \`${CLI_NAME} weixin login\` first`)
  const [ref, tab] = args
  if (!ref) {
    process.stdout.write(
      account.agent
        ? `Plain messages go to ${account.agent.taskId}${account.agent.tab ? ` ${account.agent.tab}` : ""}.\n`
        : `No agent bound: plain messages get the command help. Bind one with \`${CLI_NAME} weixin agent <task-id> [tab-N]\`.\n`,
    )
    return
  }
  if (ref === "off") {
    const { agent: _dropped, ...rest } = account
    store.writeAccount(rest)
    process.stdout.write(account.agent ? "Agent unbound.\n" : "No agent was bound.\n")
    return
  }
  if (tab !== undefined && !/^tab-[A-Za-z0-9-]+$/.test(tab)) usageError(`expected a tab id like tab-2, got "${tab}"`)
  const taskId = await resolveTaskId(ref)
  store.writeAccount({ ...account, agent: { taskId, ...(tab ? { tab } : {}) } })
  process.stdout.write(
    `Plain WeChat messages now go to ${taskId}${tab ? ` ${tab}` : ""}; commands (status, send, …) work as before.\n`,
  )
}

/** A full id, or a unique suffix as `status` prints it. Needs the daemon. */
async function resolveTaskId(ref: string): Promise<string> {
  const client = await connectIfRunning().catch(() => null)
  if (!client) fail(`the daemon is not running — start it with \`${CLI_NAME} daemon start\``)
  try {
    const { tasks } = await client.request<{ tasks: { id: string }[] }>("task.list")
    const needle = ref.toLowerCase()
    const hits = tasks.filter((t) => t.id.toLowerCase() === needle || t.id.toLowerCase().endsWith(needle))
    if (hits.length === 1 && hits[0]) return hits[0].id
    fail(hits.length === 0 ? `no task matches "${ref}"` : `"${ref}" matches ${hits.length} tasks; use more characters`)
  } finally {
    client.close()
  }
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

/** The few `lark-cli` calls Rove makes. lark-cli holds the app's credentials and does all the talking to Lark. */

import { execFile } from "node:child_process"

export const LARK_CLI = "lark-cli"

export interface CliResult {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

export function larkCli(args: readonly string[], timeoutMs = 30_000): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(LARK_CLI, [...args], { timeout: timeoutMs, encoding: "utf8" }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: stdout ?? "", stderr: stderr || (err ? err.message : "") }),
    )
  })
}

function json(stdout: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(stdout)
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The bot this lark-cli app speaks as; null when the app or its bot identity is not ready. */
export async function botInfo(): Promise<{ openId: string; name: string } | null> {
  const res = await larkCli(["api", "GET", "/open-apis/bot/v3/info", "--as", "bot"])
  const data = (json(res.stdout)?.data ?? json(res.stdout)?.bot) as
    | { open_id?: unknown; app_name?: unknown }
    | undefined
  return typeof data?.open_id === "string" && data.open_id
    ? { openId: data.open_id, name: typeof data.app_name === "string" ? data.app_name : "" }
    : null
}

/** The app lark-cli is configured with, and the signed-in user's open_id (the owner), when there is one. */
export async function authStatus(): Promise<{ appId?: string; userOpenId?: string; userName?: string }> {
  const raw = json((await larkCli(["auth", "status"])).stdout)
  const user = (raw?.identities as { user?: { openId?: unknown; userName?: unknown } } | undefined)?.user
  return {
    ...(typeof raw?.appId === "string" && raw.appId ? { appId: raw.appId } : {}),
    ...(typeof user?.openId === "string" && user.openId ? { userOpenId: user.openId } : {}),
    ...(typeof user?.userName === "string" ? { userName: user.userName } : {}),
  }
}

/** Put an emoji reaction (`OnIt`, `DONE`, `ERROR`) on a message as the bot. */
export async function react(messageId: string, emoji: string): Promise<CliResult> {
  return await larkCli([
    "im",
    "reactions",
    "create",
    "--as",
    "bot",
    "--message-id",
    messageId,
    "--data",
    JSON.stringify({ reaction_type: { emoji_type: emoji } }),
  ])
}

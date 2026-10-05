/**
 * `<home>/.rove/weixin/` — the WeChat binding's on-disk state, owner-only.
 *
 *   - `account.json`  credentials + allowlist. Written by the CLI (`rove
 *     weixin login|logout|allow|deny`), read by the daemon.
 *   - `state.json`    long-poll cursor, per-peer context tokens, recently
 *     refused senders. Written by the daemon only; stamped with the account
 *     id so a re-bind never resumes another account's cursor.
 *   - `undelivered.jsonl`  pushes that could not be sent (reply window shut,
 *     iLink refused), so nothing is dropped silently.
 *
 * Two writers never share a file, so plain tmp+rename is enough.
 */

import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME } from "@sma1lboy/rove-daemon/compat-env"
import { resolveDaemonHomeDir } from "@sma1lboy/rove-daemon/daemon/paths"

const DIR_MODE = 0o700
const FILE_MODE = 0o600
/** Refused senders kept for `rove weixin status`, newest first. */
const REJECTED_CAP = 10

export interface WeixinAccount {
  readonly accountId: string
  readonly token: string
  readonly baseUrl: string
  /** The WeChat user who scanned the QR; always allowed. */
  readonly ownerUserId: string
  /** Additional senders allowed to command Rove. */
  readonly allow: readonly string[]
  readonly savedAt: string
}

interface WeixinPeer {
  readonly contextToken?: string
  /** Epoch ms of the peer's last message — opens the reply window. */
  readonly lastInboundAt: number
}

export interface WeixinRuntimeState {
  readonly accountId: string
  readonly syncBuf: string
  readonly peers: Readonly<Record<string, WeixinPeer>>
  readonly rejected: readonly { readonly userId: string; readonly at: number }[]
}

export interface UndeliveredEntry {
  readonly at: string
  readonly to: string
  readonly reason: string
  readonly text: string
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: FILE_MODE })
  renameSync(tmp, path)
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: DIR_MODE })
}

export class WeixinStore {
  readonly dir: string

  constructor(homeDir?: string) {
    this.dir = join(resolveDaemonHomeDir(homeDir), ROVE_STATE_DIR_BASENAME, "weixin")
  }

  get accountPath(): string {
    return join(this.dir, "account.json")
  }

  get statePath(): string {
    return join(this.dir, "state.json")
  }

  get undeliveredPath(): string {
    return join(this.dir, "undelivered.jsonl")
  }

  /** `null` when unbound or unreadable — an unreadable file is not a binding. */
  readAccount(): WeixinAccount | null {
    const raw = readJson(this.accountPath) as Partial<WeixinAccount> | null
    if (!raw || typeof raw.accountId !== "string" || typeof raw.token !== "string" || !raw.accountId || !raw.token)
      return null
    return {
      accountId: raw.accountId,
      token: raw.token,
      baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl ? raw.baseUrl : "",
      ownerUserId: typeof raw.ownerUserId === "string" ? raw.ownerUserId : "",
      allow: Array.isArray(raw.allow) ? raw.allow.filter((id): id is string => typeof id === "string") : [],
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
    }
  }

  writeAccount(account: WeixinAccount): void {
    ensureDir(this.dir)
    writeJson(this.accountPath, account)
  }

  /** Unbind: credentials, cursor and context tokens go; the undelivered log stays. */
  clearAccount(): boolean {
    const had = this.readAccount() !== null
    rmSync(this.accountPath, { force: true })
    rmSync(this.statePath, { force: true })
    return had
  }

  /** The runtime state for `accountId`; a different account's state reads as fresh. */
  readState(accountId: string): WeixinRuntimeState {
    const raw = readJson(this.statePath) as Partial<WeixinRuntimeState> | null
    if (!raw || raw.accountId !== accountId) return { accountId, syncBuf: "", peers: {}, rejected: [] }
    return {
      accountId,
      syncBuf: typeof raw.syncBuf === "string" ? raw.syncBuf : "",
      peers: raw.peers && typeof raw.peers === "object" ? raw.peers : {},
      rejected: Array.isArray(raw.rejected) ? raw.rejected : [],
    }
  }

  writeState(state: WeixinRuntimeState): void {
    ensureDir(this.dir)
    writeJson(this.statePath, { ...state, rejected: state.rejected.slice(0, REJECTED_CAP) })
  }

  appendUndelivered(entry: UndeliveredEntry): void {
    ensureDir(this.dir)
    appendFileSync(this.undeliveredPath, `${JSON.stringify(entry)}\n`, { mode: FILE_MODE })
  }

  readUndelivered(): UndeliveredEntry[] {
    let text: string
    try {
      text = readFileSync(this.undeliveredPath, "utf8")
    } catch {
      return []
    }
    const entries: UndeliveredEntry[] = []
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line) as UndeliveredEntry)
      } catch {
        /* a torn last line from a crash */
      }
    }
    return entries
  }
}

/** Who may command Rove: the owner who scanned, plus `rove weixin allow` additions. */
export function isAllowedSender(account: WeixinAccount, userId: string): boolean {
  return userId !== "" && (userId === account.ownerUserId || account.allow.includes(userId))
}

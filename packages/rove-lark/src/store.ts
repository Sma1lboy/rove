/**
 * `<home>/.rove/lark/` — the Lark binding's on-disk state, owner-only.
 *
 *   - `config.json`  the bot, allowed senders and tone. Written by the CLI
 *     (`rove lark connect|allow|deny|tone`), re-read by the daemon per message.
 *   - `state.json`   the agent's task and tab, seen and pending message ids.
 *     Written by the daemon only.
 *   - `agent/`       the Lark agent's working directory (its own project).
 *
 * The app credentials stay in lark-cli's own store; Rove keeps none.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME } from "@sma1lboy/rove-daemon/compat-env"
import { resolveDaemonHomeDir } from "@sma1lboy/rove-daemon/daemon/paths"

/** Message ids remembered for de-duplication (Lark redelivers). */
const SEEN_CAP = 500

export const DEFAULT_TONE = "简短直接，像同事聊天，结论先说，不客套"

export interface LarkConfig {
  readonly botOpenId: string
  readonly botName: string
  /** lark-cli's signed-in user at connect: always let through. */
  readonly ownerOpenId?: string
  readonly ownerName?: string
  /** Other people's open_ids whose messages reach the agent. */
  readonly allow: readonly string[]
  readonly tone: string
  readonly savedAt: string
}

export interface LarkState {
  readonly agent?: { readonly taskId: string; readonly tab: string }
  /** The tone the agent last heard; a change is announced with the next message. */
  readonly tone?: string
  readonly seen: readonly string[]
  /** Admitted messages whose turn has not ended yet: they get "DONE" when it does. */
  readonly pending: readonly string[]
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []

function readJson(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"))
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}

export class LarkStore {
  readonly dir: string

  constructor(homeDir?: string) {
    this.dir = join(resolveDaemonHomeDir(homeDir), ROVE_STATE_DIR_BASENAME, "lark")
  }

  get agentDir(): string {
    return join(this.dir, "agent")
  }

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
  }

  readConfig(): LarkConfig | null {
    const raw = readJson(join(this.dir, "config.json"))
    if (!raw || typeof raw.botOpenId !== "string" || !raw.botOpenId) return null
    return {
      botOpenId: raw.botOpenId,
      botName: typeof raw.botName === "string" ? raw.botName : "",
      ...(typeof raw.ownerOpenId === "string" && raw.ownerOpenId ? { ownerOpenId: raw.ownerOpenId } : {}),
      ...(typeof raw.ownerName === "string" && raw.ownerName ? { ownerName: raw.ownerName } : {}),
      allow: strings(raw.allow),
      tone: typeof raw.tone === "string" && raw.tone ? raw.tone : DEFAULT_TONE,
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
    }
  }

  writeConfig(config: LarkConfig): void {
    this.ensureDir()
    writeJson(join(this.dir, "config.json"), config)
  }

  /** Disconnect: the binding and the daemon's state go; the agent's directory and task stay. */
  clearConfig(): boolean {
    const had = this.readConfig() !== null
    rmSync(join(this.dir, "config.json"), { force: true })
    rmSync(join(this.dir, "state.json"), { force: true })
    return had
  }

  readState(): LarkState {
    const raw = readJson(join(this.dir, "state.json"))
    const agent = raw?.agent as { taskId?: unknown; tab?: unknown } | undefined
    return {
      ...(typeof agent?.taskId === "string" && typeof agent.tab === "string"
        ? { agent: { taskId: agent.taskId, tab: agent.tab } }
        : {}),
      ...(typeof raw?.tone === "string" ? { tone: raw.tone } : {}),
      seen: strings(raw?.seen),
      pending: strings(raw?.pending),
    }
  }

  writeState(state: LarkState): void {
    this.ensureDir()
    writeJson(join(this.dir, "state.json"), { ...state, seen: state.seen.slice(-SEEN_CAP) })
  }
}
